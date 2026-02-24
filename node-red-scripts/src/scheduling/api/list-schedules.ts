/**
 * List Schedules API - GET /endpoint/schedules/
 *
 * Node wiring:
 *   [http-in: GET /endpoint/schedules/] → [function: this] → [http-response]
 *
 * Returns all schedules with runtime state including resolved times and active flag.
 */

import { getRegistry } from "./registry";
import type { ScheduleRegistry, RegistrySchedule } from "../types";
import {
    resolveEntityTime,
    isTimeInRange,
    calculateScheduleTimes,
    calculateProgress
} from "../../utils/datetime";
import { getEntity } from "../../utils/entities";

// @ts-ignore - Node-RED global
const message = msg;

const registry = getRegistry();
const now = new Date();

function resolveTime(time: string | { entity_id: string }): string {
    return resolveEntityTime(time, (entityId: string) => getEntity(entityId));
}

function getScheduleRuntime(schedule: RegistrySchedule) {
    const startTimeStr = resolveTime(schedule.start);
    const endTimeStr = schedule.end ? resolveTime(schedule.end) : null;
    const scheduleType = schedule.type || "trigger";
    const { start: startTime, end: endTime } = calculateScheduleTimes(
        startTimeStr,
        endTimeStr,
        now,
        scheduleType === "trigger" ? 10 : 0
    );

    if (!endTime) {
        return { active: false, progress: 0, startResolved: startTimeStr, endResolved: endTimeStr };
    }

    // Apply durationModifier
    let adjustedStart = startTime;
    let adjustedEnd = endTime as Date;
    if (schedule.durationModifier != null && schedule.durationModifier > 0 && schedule.durationModifier < 1) {
        const duration = adjustedEnd.getTime() - adjustedStart.getTime();
        const newDuration = duration * schedule.durationModifier;
        const offset = (duration - newDuration) / 2;
        adjustedStart = new Date(adjustedStart.getTime() + offset);
        adjustedEnd = new Date(adjustedEnd.getTime() - offset);
    }

    const active = isTimeInRange(now, adjustedStart, adjustedEnd);
    const progress = active ? calculateProgress(now, adjustedStart, adjustedEnd) : 0;

    return {
        active,
        progress: Math.round(progress * 1000) / 1000,
        startResolved: startTimeStr,
        endResolved: endTimeStr
    };
}

const schedules = Object.values(registry.schedules).map(schedule => {
    const runtime = getScheduleRuntime(schedule);

    return {
        name: schedule.name,
        source: schedule.source,
        enabled: schedule.enabled,
        type: schedule.type || "trigger",
        precedence: schedule.precedence,
        start: schedule.start,
        end: schedule.end,
        startResolved: runtime.startResolved,
        endResolved: runtime.endResolved,
        active: runtime.active,
        progress: runtime.progress,
        conditions: schedule.conditions || [],
        entities: schedule.entities || [],
        tags: schedule.tags || [],
        durationModifier: schedule.durationModifier,
        interpolation: schedule.interpolation,
        defaultStates: schedule.defaultStates,
        createdAt: schedule.createdAt,
        updatedAt: schedule.updatedAt,
        helperEntities: schedule.helperEntities
    };
});

const summary = {
    total: schedules.length,
    active: schedules.filter(s => s.active && s.enabled).length,
    enabled: schedules.filter(s => s.enabled).length,
    static: schedules.filter(s => s.source === "static").length,
    dynamic: schedules.filter(s => s.source === "dynamic").length
};

message.payload = { schedules, summary };
message.statusCode = 200;

// @ts-ignore
msg = message;
