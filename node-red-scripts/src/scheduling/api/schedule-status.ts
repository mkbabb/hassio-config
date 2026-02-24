/**
 * Schedule Status API - GET /endpoint/schedules/status
 *
 * Node wiring:
 *   [http-in: GET /endpoint/schedules/status] → [function: this] → [http-response]
 *
 * Returns aggregate runtime overview of all schedules.
 */

import { getRegistry } from "./registry";
import {
    resolveEntityTime,
    isTimeInRange,
    calculateScheduleTimes,
    calculateProgress,
    dateToTimeString
} from "../../utils/datetime";
import { getEntity } from "../../utils/entities";
import { checkConditions } from "../schedule/conditions";

// @ts-ignore - Node-RED global
const message = msg;

const registry = getRegistry();
const now = new Date();

function resolveTime(time: string | { entity_id: string }): string {
    return resolveEntityTime(time, (entityId: string) => getEntity(entityId));
}

interface ScheduleStatusEntry {
    name: string;
    progress: number;
    phase: string;
    type: string;
    startResolved: string;
    endResolved: string | null;
}

const activeSchedules: ScheduleStatusEntry[] = [];
const pendingTriggers: { name: string; nextFireAt: string }[] = [];
const inactiveSchedules: { name: string; type: string; enabled: boolean }[] = [];

for (const schedule of Object.values(registry.schedules)) {
    if (!schedule.enabled) {
        inactiveSchedules.push({ name: schedule.name, type: schedule.type || "trigger", enabled: false });
        continue;
    }

    // Check conditions
    const conditionsMet = checkConditions(schedule.conditions, message);
    if (!conditionsMet) {
        inactiveSchedules.push({ name: schedule.name, type: schedule.type || "trigger", enabled: true });
        continue;
    }

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
        inactiveSchedules.push({ name: schedule.name, type: scheduleType, enabled: true });
        continue;
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

    if (active) {
        const progress = calculateProgress(now, adjustedStart, adjustedEnd);
        let phase = "active";
        if (schedule.interpolation?.preamble_minutes) {
            const preambleStart = new Date(adjustedStart.getTime() - schedule.interpolation.preamble_minutes * 60000);
            if (now >= preambleStart && now < adjustedStart) {
                phase = "ramp_up";
            }
        }
        activeSchedules.push({
            name: schedule.name,
            progress: Math.round(progress * 1000) / 1000,
            phase,
            type: scheduleType,
            startResolved: startTimeStr,
            endResolved: endTimeStr
        });
    } else if (scheduleType === "trigger" && now < adjustedStart) {
        pendingTriggers.push({
            name: schedule.name,
            nextFireAt: dateToTimeString(adjustedStart)
        });
    } else {
        inactiveSchedules.push({ name: schedule.name, type: scheduleType, enabled: true });
    }
}

message.payload = {
    currentTime: dateToTimeString(now),
    timestamp: now.toISOString(),
    activeSchedules,
    pendingTriggers,
    inactiveSchedules,
    summary: {
        total: Object.keys(registry.schedules).length,
        active: activeSchedules.length,
        pending: pendingTriggers.length,
        inactive: inactiveSchedules.length
    },
    lastSeeded: registry.lastSeeded
};
message.statusCode = 200;

// @ts-ignore
msg = message;
