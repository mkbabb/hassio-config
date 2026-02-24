/**
 * Schedule Management System for Node-RED
 * 
 * Handles time-based entity control with support for:
 * - Continuous schedules (enforce state during time window)
 * - Trigger schedules (fire once at start/end)
 * - Entity matching via patterns and tags
 * - Schedule precedence and conditions
 * - Static state overrides and blacklisting
 * 
 * Pipeline Overview:
 * 1. Load configurations (schedules, tags, blacklists)
 * 2. Resolve schedule times from entities
 * 3. Normalize and validate schedules
 * 4. Determine entities to process
 * 5. Match entities to schedules and generate actions
 * 6. Calculate interpolation events
 * 7. Prepare debug information
 * 8. Clean up stale state
 * 9. Return formatted actions
 */

import { getEntityDomain } from "../../utils/utils";
import { groupActions, serviceToActionCall } from "../../utils/service-calls";
import {
    isTimeInRange,
    dateToTimeString,
    resolveEntityTime,
    calculateScheduleTimes,
    cleanupOldEntries,
    calculateProgress
} from "../../utils/datetime";
import {
    getEntity,
    getScheduleEntities,
    getEntitiesByPattern,
    entitiesToObject,
    filterAvailableEntities,
    getEntitiesById
} from "../../utils/entities";
import { shouldFilterEntity } from "../../utils/static-states";
import { shouldSkipAction } from "../../utils/validation";
import { checkConditions } from "./conditions";
import { normalizeEntityMatch, matchesEntity, matchesEntityByTag } from "./entity-matching";
import { processContinuousSchedule, processTriggerSchedule } from "./schedule-processing";
import type {
    NormalizedSchedule,
    Schedule,
    ScheduleEvent,
    ScheduleRegistry
} from "../types";

// ============================================================================
// TIME CALCULATIONS
// ============================================================================

/**
 * Calculates interpolation value (0-1) for current time in schedule window
 * @param now - Current time
 * @param start - Schedule start time
 * @param end - Schedule end time
 * @returns Progress value from 0 (at start) to 1 (at end)
 */
function calculateTValue(now: Date, start: Date, end: Date): number {
    return calculateProgress(now, start, end);
}

/**
 * Generates schedule events based on current time and schedule configuration
 * @param schedule - Normalized schedule with timing and interpolation settings
 * @param now - Current time for event calculation
 * @returns Array of active events (active, ramp_up, ramp_down, etc.)
 */
function calculateScheduleEvents(
    schedule: NormalizedSchedule,
    now: Date
): ScheduleEvent[] {
    const events: ScheduleEvent[] = [];

    // Check if we're in the active window
    const inActiveWindow = isTimeInRange(now, schedule.start, schedule.end);
    if (inActiveWindow) {
        const t = calculateTValue(now, schedule.start, schedule.end);
        events.push({
            schedule: schedule.name,
            type: "active",
            t,
            time: now,
            phase: "active"
        });
    } else if (schedule.type === "continuous") {
        // For continuous schedules, emit inactive events so users can track current state
        events.push({
            schedule: schedule.name,
            type: "inactive",
            t: now < schedule.start ? 0 : 1, // 0 before start, 1 after end
            time: now,
            phase: "inactive"
        });
    }

    // Check for preamble events if interpolation is enabled
    if (schedule.interpolation?.enabled && schedule.interpolation.preamble_minutes) {
        const preambleMinutes = schedule.interpolation.preamble_minutes;

        // Ramp up before start (sunrise)
        const rampUpStart = new Date(
            schedule.start.getTime() - preambleMinutes * 60 * 1000
        );
        if (now >= rampUpStart && now < schedule.start) {
            const t = calculateTValue(now, rampUpStart, schedule.start);
            events.push({
                schedule: schedule.name,
                type: "ramp_up",
                t,
                time: now,
                phase: "sunrise"
            });
        }

        // Ramp down before end (sunset preparation)
        const rampDownBeforeEnd = new Date(
            schedule.end.getTime() - preambleMinutes * 60 * 1000
        );
        if (now >= rampDownBeforeEnd && now < schedule.end) {
            const t = 1 - calculateTValue(now, rampDownBeforeEnd, schedule.end);
            events.push({
                schedule: schedule.name,
                type: "ramp_down_before_end",
                t,
                time: now,
                phase: "sunset_prep"
            });
        }
    }

    // Check for postamble events if interpolation is enabled
    if (schedule.interpolation?.enabled && schedule.interpolation.postamble_minutes) {
        const postambleMinutes = schedule.interpolation.postamble_minutes;

        // Ramp down after end (sunset)
        const rampDownEnd = new Date(
            schedule.end.getTime() + postambleMinutes * 60 * 1000
        );
        if (now >= schedule.end && now < rampDownEnd) {
            const t = 1 - calculateTValue(now, schedule.end, rampDownEnd);
            events.push({
                schedule: schedule.name,
                type: "ramp_down",
                t,
                time: now,
                phase: "sunset"
            });
        }
    }

    return events;
}


// ============================================================================
// TIME RESOLUTION
// ============================================================================

/**
 * Resolves time from string or entity reference
 * @param time - Time string or entity reference object
 * @param scheduleEntities - Map of schedule entities for lookup
 * @returns Resolved time string
 */
function resolveScheduleTime(
    time: string | { entity_id: string },
    scheduleEntities: Record<string, Hass.State>
): string {
    return resolveEntityTime(time, (entityId: string) => {
        // First try schedule entities collection
        if (scheduleEntities[entityId]) {
            return scheduleEntities[entityId];
        }
        // Fallback to direct entity access
        return getEntity(entityId);
    });
}

// ============================================================================
// MAIN SCHEDULING PIPELINE
// ============================================================================

// STEP 1: Initialize context and load configurations
// @ts-ignore
const registry: ScheduleRegistry = global.get("scheduleRegistry") ?? { version: 1, schedules: {}, tagDefinitions: {}, lastSeeded: null };
const schedules: Schedule[] = Object.values(registry.schedules).filter(s => s.enabled);
const tagDefinitions = registry.tagDefinitions;
// @ts-ignore
const triggeredSchedules = flow.get("triggeredSchedules") ?? {};
// @ts-ignore
const message: Hass.Message = msg;
// @ts-ignore
const additionalBlacklist: string[] = msg.blacklist || [];

const now = new Date();

// STEP 2: Load schedule entities (input_datetime, sensors) for time resolution
const allScheduleEntities = getScheduleEntities();
const scheduleEntities = entitiesToObject(allScheduleEntities);

// STEP 3: Normalize and validate schedules
const normalizedSchedules: NormalizedSchedule[] = schedules
    .map((schedule) => {
        // STEP 3a: Extract schedule properties
        const {
            name,
            entities,
            tags,
            start,
            end,
            precedence,
            conditions,
            interpolation
        } = schedule;

        // STEP 3b: Resolve times from entities or static strings
        const startTimeString = resolveScheduleTime(start, scheduleEntities);
        const endTimeString = end ? resolveScheduleTime(end, scheduleEntities) : null;

        // STEP 3c: Calculate actual datetime with midnight handling
        const scheduleType = schedule.type || "trigger";
        const { start: startTime, end: endTime } = calculateScheduleTimes(
            startTimeString,
            endTimeString,
            now,
            scheduleType === "trigger" ? 10 : 0 // 10-minute window for triggers
        );

        if (!endTime) {
            return null; // Invalid schedule
        }

        // STEP 3c-ii: Apply durationModifier (centered shrink)
        let adjustedStart = startTime;
        let adjustedEnd = endTime as Date;
        if (schedule.durationModifier != null && schedule.durationModifier > 0 && schedule.durationModifier < 1) {
            const duration = adjustedEnd.getTime() - adjustedStart.getTime();
            const newDuration = duration * schedule.durationModifier;
            const offset = (duration - newDuration) / 2;
            adjustedStart = new Date(adjustedStart.getTime() + offset);
            adjustedEnd = new Date(adjustedEnd.getTime() - offset);
        }

        // STEP 3d: Build normalized schedule object
        return {
            name,
            entities: entities?.filter((e) => e != null).flatMap(normalizeEntityMatch),
            tags,
            start: adjustedStart,
            end: adjustedEnd,
            startTime: dateToTimeString(adjustedStart),
            endTime: dateToTimeString(adjustedEnd),
            precedence,
            durationModifier: schedule.durationModifier,
            conditions,
            interpolation: interpolation || { enabled: true }, // Enable t calculation by default
            defaultStates: schedule.defaultStates,
            type: schedule.type || "trigger" // Default to trigger
        };
    })
    .filter(
        (s) =>
            s !== null && checkConditions(s.conditions, message)
    ) as NormalizedSchedule[]; // STEP 3e: Filter by conditions

// STEP 4: Determine which entities to process
let entitiesToCheck: Hass.State[] = [];
let entityIdsToFetch = new Set<string>();
let patternsToMatch: RegExp[] = [];

if (message.payload && Array.isArray(message.payload)) {
    entitiesToCheck = filterAvailableEntities(message.payload);
} else {
    // Optimize entity fetching by collecting all entity IDs first
    entityIdsToFetch = new Set<string>();
    patternsToMatch = [];

    // Collect specific entity IDs and patterns from schedules
    normalizedSchedules.forEach((schedule) => {
        if (schedule.entities) {
            schedule.entities.forEach((config) => {
                // If pattern matches exact entity ID format, add to direct fetch list
                const exactMatch = config.pattern.source.match(/^\^(.+)\$$/);
                if (exactMatch && !exactMatch[1].includes("\\")) {
                    entityIdsToFetch.add(exactMatch[1]);
                } else {
                    patternsToMatch.push(config.pattern);
                }
            });
        }
    });

    // Fetch known entity IDs directly (much faster)
    if (entityIdsToFetch.size > 0) {
        const directEntities = getEntitiesById(Array.from(entityIdsToFetch));
        entitiesToCheck.push(...Object.values(directEntities));
    }

    // Fetch pattern-matched entities
    patternsToMatch.forEach((pattern) => {
        const matches = getEntitiesByPattern(pattern);
        entitiesToCheck.push(...matches);
    });

    // Add tagged entities
    Object.entries(tagDefinitions).forEach(([tag, patterns]) => {
        if (Array.isArray(patterns)) {
            patterns.forEach((pattern: string) => {
                const matches = getEntitiesByPattern(pattern);
                entitiesToCheck.push(...matches);
            });
        }
    });

    // STEP 4a: Remove duplicate entities
    const entityMap = new Map<string, Hass.State>();
    entitiesToCheck.forEach((entity) => {
        entityMap.set(entity.entity_id, entity);
    });
    entitiesToCheck = Array.from(entityMap.values());
}

// STEP 5: Process each entity against matching schedules
const serviceActions: Partial<Hass.Service>[] = [];
const entityScheduleMatches: any[] = [];
const debugMatches: any[] = []; // Track blind matches for debugging
const skippedActions: any[] = []; // Track actions skipped by validation

entitiesToCheck.forEach((entity) => {
    // Skip entities that are:
    // 1. In msg.blacklist (temporary blacklist)
    // 2. In global blacklist (any namespace)
    // 3. Have static state overrides (any namespace)
    if (shouldFilterEntity(entity.entity_id, {
        checkBlacklist: true,
        checkStaticState: true,
        additionalBlacklist: additionalBlacklist
    })) {
        return;
    }

    // Find matching schedules
    const matchingSchedules = normalizedSchedules
        .filter((schedule) => {
            if (!schedule.entities || schedule.entities.length === 0) {
                // Check tag match for schedules without entities
                return matchesEntityByTag(
                    entity.entity_id,
                    schedule.tags,
                    tagDefinitions
                );
            }

            const entityMatch = matchesEntity(entity.entity_id, schedule.entities);
            const tagMatch = matchesEntityByTag(
                entity.entity_id,
                schedule.tags,
                tagDefinitions
            );

            return entityMatch || tagMatch;
        })
        .sort((a, b) => b.precedence - a.precedence);

    if (matchingSchedules.length === 0) return;

    // Use the highest precedence schedule (active or not)
    const activeSchedule = matchingSchedules[0];
    const entityConfig = activeSchedule.entities
        ? matchesEntity(entity.entity_id, activeSchedule.entities)
        : null;

    const isActive = isTimeInRange(now, activeSchedule.start, activeSchedule.end);


    // Handle continuous vs trigger schedules
    if (activeSchedule.type === "continuous") {
        // Continuous: Enforce state throughout active period
        const action = processContinuousSchedule(
            entity as Hass.State,
            activeSchedule,
            entityConfig,
            isActive
        );

        if (action) {
            // Validate action before adding
            const validation = shouldSkipAction(action);
            if (validation.skip) {
                skippedActions.push({
                    entity_id: entity.entity_id,
                    schedule: activeSchedule.name,
                    reason: validation.reason,
                    action: action.service
                });
            } else {
                serviceActions.push(action);
            }
        }
    } else if (activeSchedule.type === "trigger") {
        // Use the abstracted trigger schedule processor
        const { action } = processTriggerSchedule(
            entity as Hass.State,
            activeSchedule,
            entityConfig,
            now,
            triggeredSchedules
        );

        if (action) {
            // Validate action before adding
            const validation = shouldSkipAction(action);
            if (validation.skip) {
                skippedActions.push({
                    entity_id: entity.entity_id,
                    schedule: activeSchedule.name,
                    reason: validation.reason,
                    action: action.service
                });
            } else {
                serviceActions.push(action);
            }
        }
    }

    // Track match info
    entityScheduleMatches.push({
        entity_id: entity.entity_id,
        schedule: activeSchedule.name,
        active: isActive,
        precedence: activeSchedule.precedence
    });
});

// STEP 6: Calculate schedule events for interpolation and monitoring
const allScheduleEvents: ScheduleEvent[] = [];
normalizedSchedules.forEach((schedule) => {
    const events = calculateScheduleEvents(schedule, now);
    allScheduleEvents.push(...events);
});

// STEP 7: Prepare debug information
const debugInfo = {
    schedulesFound: schedules.length,
    entitiesChecked: entitiesToCheck.length,
    actionsGenerated: serviceActions.length,
    actionsSkipped: skippedActions.length,
    currentTime: dateToTimeString(now),
    activeSchedules: normalizedSchedules
        .filter((s) => isTimeInRange(now, s.start, s.end))
        .map((s) => ({
            name: s.name,
            type: s.type,
            startTime: s.startTime,
            endTime: s.endTime
        })),
    blindMatches: debugMatches.length > 0 ? debugMatches : "No blind entities matched",
    skippedActions: skippedActions.length > 0 ? skippedActions : "No actions skipped by validation"
};

// STEP 8: Clean up stale trigger states (>24 hours old)
const cleanedTriggeredSchedules = cleanupOldEntries(
    triggeredSchedules,
    (value) => {
        if (value && typeof value === 'object' && 'on' in value && 'off' in value) {
            const triggerObj = value as { on: string | null; off: string | null };
            // Return the most recent activity timestamp
            const timestamps = [triggerObj.on, triggerObj.off].filter(t => t !== null);
            if (timestamps.length > 0) {
                return timestamps.sort().pop() || null;
            }
        }
        return null;
    },
    24 * 60 * 60 * 1000 // Keep entries for 24 hours
);

// Save triggered schedules back to flow context
// @ts-ignore
flow.set("triggeredSchedules", cleanedTriggeredSchedules);

// STEP 9: Format and return results
// @ts-ignore
msg.payload = groupActions(serviceActions.map(serviceToActionCall));
// @ts-ignore
msg.scheduleEvents = allScheduleEvents;
// @ts-ignore
msg.entityScheduleMatches = entityScheduleMatches;
// @ts-ignore
msg.debug = debugInfo;
// @ts-ignore
