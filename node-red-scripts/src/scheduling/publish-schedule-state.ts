/**
 * Schedule State Publisher
 * Publishes schedule states as HA sensor entities via REST API.
 *
 * Node wiring:
 *   [schedule engine output] → [function: this] → [split] → [ha-api: POST /api/states/] → [join]
 *
 * Input: msg.scheduleEvents, msg.debug, msg.entityScheduleMatches
 * Output: msg.payload = array of {entity_id, state, attributes} for HA REST API
 *
 * Deduplication: Compares proposed sensor state against last-published state
 * (stored in flow context). Only changed sensors are published.
 */

import type { ScheduleEvent, ScheduleRegistry } from "./types";
import {
    resolveEntityTime,
    isTimeInRange,
    calculateScheduleTimes,
    calculateProgress,
    dateToTimeString
} from "../utils/datetime";
import { getEntity } from "../utils/entities";
import { getExternalModificationSummary } from "../utils/static-states";

// @ts-ignore - Node-RED global
const message = msg;

const PUBLISHED_KEY = "publishedScheduleStates";
const now = new Date();

// @ts-ignore
const registry: ScheduleRegistry = global.get("scheduleRegistry") ?? { version: 1, schedules: {}, tagDefinitions: {}, lastSeeded: null };

// @ts-ignore — ephemeral dedup cache, not persisted across restarts
const lastPublished: Record<string, any> = flow.get(PUBLISHED_KEY, "memory") ?? {};

const debug = message.debug || {};
const scheduleEvents: ScheduleEvent[] = message.scheduleEvents || [];
const entityMatches: any[] = message.entityScheduleMatches || [];

function resolveTime(time: string | { entity_id: string }): string {
    return resolveEntityTime(time, (entityId: string) => getEntity(entityId));
}

interface SensorUpdate {
    entity_id: string;
    state: string;
    attributes: Record<string, any>;
}

const updates: SensorUpdate[] = [];

// Per-schedule sensors (publish all schedules, including disabled ones for dashboard visibility)
for (const schedule of Object.values(registry.schedules)) {

    const scheduleKey = schedule.name.replace(/[^a-z0-9_]/g, "_");
    const statusEntityId = `sensor.schedule_${scheduleKey}_status`;
    const progressEntityId = `sensor.schedule_${scheduleKey}_progress`;

    // Resolve times (skip for disabled schedules)
    let startTimeStr = "";
    let endTimeStr: string | null = null;
    let active = false;
    let progress = 0;
    let phase = "inactive";

    if (!schedule.enabled) {
        // Disabled — still resolve times for display but skip active checks
        try {
            startTimeStr = resolveTime(schedule.start);
            endTimeStr = schedule.end ? resolveTime(schedule.end) : null;
        } catch { /* ignore */ }
    } else try {
        startTimeStr = resolveTime(schedule.start);
        endTimeStr = schedule.end ? resolveTime(schedule.end) : null;
        const scheduleType = schedule.type || "trigger";
        const { start: startTime, end: endTime } = calculateScheduleTimes(
            startTimeStr,
            endTimeStr,
            now,
            scheduleType === "trigger" ? 10 : 0
        );

        if (endTime) {
            let adjustedStart = startTime;
            let adjustedEnd = endTime as Date;
            if (schedule.durationModifier != null && schedule.durationModifier > 0 && schedule.durationModifier < 1) {
                const duration = adjustedEnd.getTime() - adjustedStart.getTime();
                const newDuration = duration * schedule.durationModifier;
                const offset = (duration - newDuration) / 2;
                adjustedStart = new Date(adjustedStart.getTime() + offset);
                adjustedEnd = new Date(adjustedEnd.getTime() - offset);
            }

            active = isTimeInRange(now, adjustedStart, adjustedEnd);
            if (active) {
                progress = calculateProgress(now, adjustedStart, adjustedEnd);
                phase = "active";
            }

            // Check interpolation phases
            if (schedule.interpolation?.preamble_minutes) {
                const preambleStart = new Date(adjustedStart.getTime() - schedule.interpolation.preamble_minutes * 60000);
                if (now >= preambleStart && now < adjustedStart) {
                    phase = "ramp_up";
                    progress = calculateProgress(now, preambleStart, adjustedStart);
                }
            }
            if (schedule.interpolation?.postamble_minutes) {
                const postambleEnd = new Date(adjustedEnd.getTime() + schedule.interpolation.postamble_minutes * 60000);
                if (now >= adjustedEnd && now < postambleEnd) {
                    phase = "ramp_down";
                    progress = 1 - calculateProgress(now, adjustedEnd, postambleEnd);
                }
            }
        }
    } catch (e) {
        // Time resolution failure — mark inactive
    }

    // Find the schedule event for t value
    const event = scheduleEvents.find(e => e.schedule === schedule.name && (e.type === "active" || e.type === "ramp_up" || e.type === "ramp_down"));
    const t = event ? event.t : (active ? progress : 0);

    // Count matched entities for this schedule
    const matchedCount = entityMatches.filter(m => m.schedule === schedule.name).length;

    // Status sensor — disabled schedules always show "disabled"
    const statusState = !schedule.enabled ? "disabled"
        : active ? (phase !== "inactive" ? phase : "active") : "inactive";
    updates.push({
        entity_id: statusEntityId,
        state: statusState,
        attributes: {
            friendly_name: `Schedule ${schedule.name} Status`,
            icon: active ? "mdi:calendar-check" : "mdi:calendar-blank",
            t: Math.round(t * 1000) / 1000,
            phase,
            start_time: startTimeStr,
            end_time: endTimeStr || "",
            type: schedule.type || "trigger",
            precedence: schedule.precedence,
            source: schedule.source,
            enabled: schedule.enabled,
            clear_static_on_transition: schedule.clearStaticOnTransition ?? false,
            matched_entity_count: matchedCount,
            conditions: JSON.stringify(schedule.conditions || [])
        }
    });

    // Progress sensor
    updates.push({
        entity_id: progressEntityId,
        state: String(Math.round(t * 1000) / 1000),
        attributes: {
            friendly_name: `Schedule ${schedule.name} Progress`,
            icon: "mdi:progress-clock",
            unit_of_measurement: ""
        }
    });
}

// Aggregate sensors
const activeNames = Object.values(registry.schedules)
    .filter(s => s.enabled)
    .filter(s => {
        const event = scheduleEvents.find(e => e.schedule === s.name && e.type === "active");
        return !!event;
    })
    .map(s => s.name);

updates.push({
    entity_id: "sensor.active_schedule_count",
    state: String(activeNames.length),
    attributes: {
        friendly_name: "Active Schedule Count",
        icon: "mdi:calendar-clock",
        active_names: activeNames.join(",")
    }
});

const externalModSummary = getExternalModificationSummary();

updates.push({
    entity_id: "sensor.schedule_engine_last_run",
    state: now.toISOString(),
    attributes: {
        friendly_name: "Schedule Engine Last Run",
        icon: "mdi:engine",
        schedules_evaluated: debug.schedulesFound || 0,
        actions_generated: debug.actionsGenerated || 0,
        actions_skipped: debug.actionsSkipped || 0,
        entities_checked: debug.entitiesChecked || 0,
        current_time: debug.currentTime || dateToTimeString(now),
        external_overrides: externalModSummary.count,
        external_override_entities: externalModSummary.entities.join(",") || "none"
    }
});

// External modification sensor
updates.push({
    entity_id: "sensor.external_overrides",
    state: String(externalModSummary.count),
    attributes: {
        friendly_name: "External State Overrides",
        icon: externalModSummary.count > 0 ? "mdi:hand-back-right" : "mdi:check-circle",
        entities: externalModSummary.entities.join(",") || "none",
        schedules: externalModSummary.schedules.join(",") || "none",
        oldest_age_minutes: externalModSummary.oldestMs
            ? Math.round((Date.now() - externalModSummary.oldestMs) / 60000)
            : 0
    }
});

// Deduplication: only publish changed sensors
const changedUpdates: SensorUpdate[] = [];
const newPublished: Record<string, any> = {};

for (const update of updates) {
    const key = update.entity_id;
    const prev = lastPublished[key];
    const current = { state: update.state, attributes: update.attributes };

    // Simple comparison: check if state changed or key attributes changed
    if (!prev || prev.state !== current.state || JSON.stringify(prev.attributes) !== JSON.stringify(current.attributes)) {
        changedUpdates.push(update);
    }
    newPublished[key] = current;
}

// Save last-published state for next dedup check (ephemeral — memory store)
// @ts-ignore
flow.set(PUBLISHED_KEY, newPublished, "memory");

// Output only changed sensors for downstream split → api chain
// @ts-ignore
msg.payload = changedUpdates.length > 0 ? changedUpdates : null;
// @ts-ignore
msg.sensorUpdateCount = changedUpdates.length;
// @ts-ignore
msg.totalSensorCount = updates.length;
