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

import {
    groupActions,
    serviceToActionCall,
    getEntityDomain,
    domainToService
} from "../utils/utils";
import {
    isTimeInRange,
    timeStringToDate,
    dateToTimeString,
    compareTime,
    calculateProgress,
    resolveEntityTime,
    calculateScheduleTimes,
    isWithinWindow,
    cleanupOldEntries
} from "../utils/datetime";
import {
    getScheduleEntities,
    getEntitiesByPattern,
    entitiesToObject,
    filterAvailableEntities,
    getEntity,
    getEntitiesById
} from "../utils/ha-entities";
import {
    shouldFilterEntity
} from "../utils/static-states";
import { DomainStates, PRESENCE_STATE_ENTITY_ID } from "./types";
import type {
    NormalizedSchedule,
    Schedule,
    ScheduleCondition,
    ScheduleEvent,
    EntityMatch,
    EntityConfig,
    NormalizedEntityConfig,
    EntityState
} from "./types";

// ============================================================================
// CONDITION CHECKING
// ============================================================================

/**
 * Evaluates schedule conditions against current state
 * @param conditions - Array of conditions to check (presence, entity states)
 * @param msg - Node-RED message for context
 * @returns true if all conditions pass or no conditions defined
 */
function checkConditions(
    conditions: ScheduleCondition[] | undefined,
    msg: any
): boolean {
    if (!conditions || conditions.length === 0) {
        return true;
    }

    // Use getEntity for cleaner direct access
    const presenceEntity = getEntity(PRESENCE_STATE_ENTITY_ID);
    const presenceState = presenceEntity?.state;

    return conditions.every((condition) => {
        switch (condition.type) {
            case "presence":
                return presenceState === condition.value;
            case "state":
                if (!condition.entity_id) return true;
                const entity = getEntity(condition.entity_id);
                return entity?.state === condition.value;
            default:
                return true;
        }
    });
}

// ============================================================================
// ENTITY MATCHING & NORMALIZATION
// ============================================================================

/**
 * Normalizes various entity match formats into consistent config objects
 * @param match - String, regex, array, or config object to normalize
 * @returns Array of normalized entity configurations with patterns
 */
function normalizeEntityMatch(match: EntityMatch): NormalizedEntityConfig[] {
    if (!match) {
        return [{ pattern: new RegExp("(?!)") }];
    }

    // Handle arrays
    if (Array.isArray(match)) {
        return match.flatMap((m) => normalizeEntityMatch(m));
    }

    if (typeof match === "string") {
        // Check if it's a regex pattern with prefix
        if (match.startsWith("regex:")) {
            const pattern = match.substring(6); // Remove "regex:" prefix
            return [{ pattern: new RegExp(pattern) }];
        } else {
            // Plain string entity ID
            return [
                {
                    pattern: new RegExp(
                        `^${match.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`
                    )
                }
            ];
        }
    } else if (match instanceof RegExp) {
        // RegExp pattern
        return [{ pattern: match }];
    } else if (match && typeof match === "object") {
        // Check if it's an empty object {}
        if (Object.keys(match).length === 0) {
            return [{ pattern: new RegExp("(?!)") }];
        }

        // EntityConfig object
        const config = match as EntityConfig;

        // Check if entity_id exists
        if (!config.entity_id) {
            return [{ pattern: new RegExp("(?!)") }];
        }

        // Handle array of entity_ids in config
        if (Array.isArray(config.entity_id)) {
            return config.entity_id.map((id) => {
                const pattern =
                    id instanceof RegExp
                        ? id
                        : new RegExp(
                              `^${String(id).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`
                          );
                return {
                    pattern,
                    states: config.states
                };
            });
        }

        // Single entity_id
        const pattern =
            config.entity_id instanceof RegExp
                ? config.entity_id
                : new RegExp(
                      `^${String(config.entity_id).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`
                  );
        return [
            {
                pattern,
                states: config.states
            }
        ];
    }

    // Fallback
    return [{ pattern: new RegExp("(?!)") }];
}

/**
 * Checks if entity ID matches any configured patterns
 * @param entityId - Entity to check
 * @param entityConfigs - Normalized configurations to match against
 * @returns Matching config or null
 */
function matchesEntity(
    entityId: string,
    entityConfigs: NormalizedEntityConfig[] | undefined
): NormalizedEntityConfig | null {
    if (!entityConfigs) return null;

    for (const config of entityConfigs) {
        if (config.pattern.test(entityId)) {
            return config;
        }
    }
    return null;
}

/**
 * Checks if entity matches any defined tags
 * @param entityId - Entity to check
 * @param tags - Tag names to match
 * @param tagDefinitions - Map of tag names to entity patterns
 * @param allowedDomains - Domains allowed for tag matching
 * @returns true if entity matches any tag
 */
function matchesEntityByTag(
    entityId: string,
    tags: string[] | undefined,
    tagDefinitions: Record<string, string[]>,
    allowedDomains: string[] = [
        "light",
        "switch",
        "fan",
        "climate",
        "lock",
        "cover",
        "media_player"
    ]
): boolean {
    if (!tags || tags.length === 0) return false;

    // Check if entity domain is allowed
    const domain = getEntityDomain(entityId);
    if (!allowedDomains.includes(domain)) return false;

    for (const tag of tags) {
        const patterns = tagDefinitions[tag] || [];
        if (patterns.some((pattern) => new RegExp(pattern).test(entityId))) {
            return true;
        }
    }
    return false;
}

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
// STATE DETERMINATION
// ============================================================================

/**
 * Determines target state for entity based on domain and schedule state
 * @param domain - Entity domain (light, switch, climate, etc.)
 * @param isActive - Whether schedule is active
 * @param customState - Optional custom state configuration
 * @returns Target state string (on/off/heat/cool/etc.)
 */
function getTargetState(
    domain: string,
    isActive: boolean,
    customState?: EntityState
): string {
    // Use custom state if provided
    if (customState?.state) {
        return customState.state;
    }

    // Get domain-specific states
    const domainStates = DomainStates[domain as keyof typeof DomainStates];
    if (domainStates) {
        return isActive ? domainStates.on : domainStates.off;
    }

    // Fallback to on/off
    return isActive ? "on" : "off";
}

/**
 * Maps entity state to appropriate service call
 * @param domain - Entity domain
 * @param state - Target state
 * @param customService - Optional custom service override
 * @returns Service name (turn_on, turn_off, set_hvac_mode, etc.)
 */
function getServiceForState(
    domain: string,
    state: string,
    customService?: string
): string {
    // Use custom service if provided
    if (customService) return customService;

    // Create a mock entity to leverage domainToService from utils
    const mockEntity: Partial<Hass.State> = {
        state: state,
        entity_id: `${domain}.mock`,
        attributes: {}
    };

    // Get service from utils domainToService
    const service = domainToService(mockEntity as Hass.State, domain);

    // If domainToService returned a valid service, use it
    if (service) {
        return service;
    }

    // Fallback for any edge cases not handled by domainToService
    return "set_state";
}

/**
 * Builds service call for entity based on schedule and current state
 * @param entity - Current entity state
 * @param schedule - Active schedule configuration
 * @param entityConfig - Entity-specific configuration
 * @param isActive - Whether schedule is in active period
 * @returns Service call object or null if no action needed
 */
function determineEntityAction(
    entity: Hass.State,
    schedule: NormalizedSchedule,
    entityConfig: NormalizedEntityConfig | null,
    isActive: boolean
): Partial<Hass.Service> | null {
    const domain = getEntityDomain(entity.entity_id);

    // Get the appropriate state config
    const stateKey = isActive ? "on" : "off";
    let stateConfig =
        entityConfig?.states?.[stateKey] || schedule.defaultStates?.[stateKey];

    // If no state config is defined, provide default turn_on/turn_off behavior
    if (!stateConfig) {
        stateConfig = {
            service: isActive ? "turn_on" : "turn_off"
        };
    }

    // For unidirectional schedules: if schedule is inactive and no "off" state is defined, skip
    // (This check is now after we've provided defaults, so only applies to explicitly null configs)
    if (!isActive && !stateConfig) {
        return null;
    }

    // Determine target state
    const targetState = getTargetState(domain, isActive, stateConfig);

    // Check if entity already in target state
    if (entity.state === targetState) return null;

    // Determine service to call
    const service = getServiceForState(domain, targetState, stateConfig?.service);

    // If no valid service for this domain, skip
    if (!service || service === "set_state") {
        return null;
    }

    // Build service data
    const serviceData: Record<string, any> = {
        entity_id: entity.entity_id,
        ...(stateConfig?.data || {})
    };

    // Add state-specific data
    if (domain === "climate" && service === "set_hvac_mode") {
        serviceData.hvac_mode = targetState;
    }

    return {
        domain: stateConfig?.domain || domain,
        service,
        data: serviceData
    };
}

// ============================================================================
// SCHEDULE PROCESSORS
// ============================================================================

/**
 * Processes continuous schedule - enforces state throughout active period
 * @param entity - Entity to control
 * @param schedule - Schedule configuration
 * @param entityConfig - Entity-specific settings
 * @param isActive - Whether in active time window
 * @returns Service call to enforce correct state
 */
function processContinuousSchedule(
    entity: Hass.State,
    schedule: NormalizedSchedule,
    entityConfig: NormalizedEntityConfig | null,
    isActive: boolean
): Partial<Hass.Service> | null {
    // Continuous: Always enforce state during active period
    return determineEntityAction(entity, schedule, entityConfig, isActive);
}

/**
 * Processes trigger schedule - fires once at start and once at end
 * @param entity - Entity to control
 * @param schedule - Schedule configuration
 * @param entityConfig - Entity-specific settings
 * @param now - Current time
 * @param triggeredSchedules - State tracking for fired triggers
 * @returns Action to execute and whether trigger state was updated
 */
function processTriggerSchedule(
    entity: Hass.State,
    schedule: NormalizedSchedule,
    entityConfig: NormalizedEntityConfig | null,
    now: Date,
    triggeredSchedules: Record<string, any>
): { action: Partial<Hass.Service> | null; updateTriggerState: boolean } {
    const scheduleKey = `${schedule.name}_${entity.entity_id}`;
    const triggerState: { on: string | null; off: string | null } = 
        triggeredSchedules[scheduleKey] || { on: null, off: null };
    
    const triggerWindowMs = 10 * 60 * 1000; // 10 minutes
    
    // Use datetime utilities for window checking
    const inStartWindow = isWithinWindow(now, schedule.start, triggerWindowMs);
    const inEndWindow = isWithinWindow(now, schedule.end, triggerWindowMs);
    const pastEndWindow = now.getTime() > (schedule.end.getTime() + triggerWindowMs);
    
    let action: Partial<Hass.Service> | null = null;
    let updateTriggerState = false;
    
    // Handle ON trigger: trigger within start window
    if (inStartWindow && !triggerState.on) {
        action = determineEntityAction(entity, schedule, entityConfig, true);
        if (action) {
            triggerState.on = now.toISOString();
            triggeredSchedules[scheduleKey] = triggerState;
            updateTriggerState = true;
        }
    }
    
    // Handle OFF trigger: trigger within end window
    if (inEndWindow && !triggerState.off) {
        const offAction = determineEntityAction(entity, schedule, entityConfig, false);
        if (offAction) {
            // If we already have an ON action, OFF takes precedence in same cycle
            action = offAction;
            triggerState.off = now.toISOString();
            triggeredSchedules[scheduleKey] = triggerState;
            updateTriggerState = true;
        }
    }
    
    // Reset state when we're past the schedule for next cycle
    // Only reset if we've passed the end window AND both triggers have fired
    if (pastEndWindow && triggerState.on && triggerState.off) {
        delete triggeredSchedules[scheduleKey];
        updateTriggerState = true;
    }
    
    return { action, updateTriggerState };
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
const schedules: Schedule[] = flow.get("schedules") ?? [];
// @ts-ignore
const tagDefinitions = flow.get("tagDefinitions") ?? {};
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

        // STEP 3d: Build normalized schedule object
        return {
            name,
            entities: entities?.filter((e) => e != null).flatMap(normalizeEntityMatch),
            tags,
            start: startTime,
            end: endTime as Date,
            startTime: dateToTimeString(startTime),
            endTime: endTime ? dateToTimeString(endTime) : undefined,
            precedence,
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
            serviceActions.push(action);
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
            serviceActions.push(action);
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
    currentTime: dateToTimeString(now),
    activeSchedules: normalizedSchedules
        .filter((s) => isTimeInRange(now, s.start, s.end))
        .map((s) => ({
            name: s.name,
            type: s.type,
            startTime: s.startTime,
            endTime: s.endTime
        }))
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
msg.debug = debugInfo;
// @ts-ignore
