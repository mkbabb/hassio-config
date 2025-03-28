import {
    groupActions,
    isTimeInRange,
    timeStringToDate,
    serviceToActionCall,
    dateToTimeString,
    createStatesObject,
    compareTime
} from "../utils/utils";

import { NormalizedSchedule, Schedule } from "./schedules";

function determineEntityStatus(
    entity: Hass.State,
    now: Date,
    msg: any,
    schedules: NormalizedSchedule[],
    staticPlantStates: Record<string, any>
): { state: "on" | "off"; schedule: NormalizedSchedule } | null {
    // Check static states first
    if (staticPlantStates[entity.entity_id] != null) {
        return null;
    }

    // Find highest precedence matching schedule
    const matchingSchedules = schedules.filter((schedule) =>
        schedule.entities.some((pattern) => pattern.test(entity.entity_id))
    );

    if (matchingSchedules.length === 0) {
        return null;
    }

    const matchingSchedule = matchingSchedules[0];

    return {
        state: isTimeInRange(now, matchingSchedule.start, matchingSchedule.end)
            ? "on"
            : "off",
        schedule: matchingSchedule
    };
}

// @ts-ignore
const schedules: Schedule[] = flow.get("schedules") ?? [];

// @ts-ignore
const staticPlantStates = flow.get("staticPlantStates") ?? {};

// @ts-ignore
const message: Hass.Message = msg;

const now = new Date();

// Get valid entities and create service actions
const entities: Hass.State[] = (
    Array.isArray(message.payload) ? message.payload : [message.payload]
).filter((entity) => entity?.entity_id && entity.state !== "unavailable");

// @ts-ignore
const scheduleEntities = createStatesObject(msg.schedule_entities, true);

// normalize schedules from msg.schedule_entities:
const normalizedSchedules: NormalizedSchedule[] = schedules
    .map((schedule) => {
        const { name, entities, start, end, precedence } = schedule;

        const startOverride = scheduleEntities?.[`${name}_schedule_start`];
        const endOverride = scheduleEntities?.[`${name}_schedule_end`];

        const startTimeString = startOverride ? startOverride.state : start;
        const endTimeString = endOverride ? endOverride.state : end;

        const startTime = timeStringToDate(startTimeString);
        const endTime = timeStringToDate(endTimeString);

        startTime.setDate(now.getDate());
        endTime.setDate(now.getDate());

        // If the startTime is after the endTime
        if (compareTime(startTime, endTime) >= 0) {
            // If the current time is before the endTime, we need to subtract a day from the startTime
            if (compareTime(now, endTime) < 1) {
                startTime.setDate(startTime.getDate() - 1);
            } else {
                // Otherwise, we need to add a day to the endTime
                endTime.setDate(endTime.getDate() + 1);
            }
            // If the current time is after the endTime, we need to add a day to the startTime
        } else if (compareTime(now, endTime) > 1) {
            startTime.setDate(startTime.getDate() + 1);
        }

        return {
            name,
            entities: entities.map((entity) => new RegExp(entity)),
            start: startTime,
            end: endTime,
            startTime: startTime.toLocaleDateString("en-US", {
                hour: "2-digit",
                minute: "2-digit",
                hour12: false
            }),
            endTime: endTime.toLocaleDateString("en-US", {
                hour: "2-digit",
                minute: "2-digit",
                hour12: false
            }),
            precedence
        };
    })
    .sort((a, b) => b.precedence - a.precedence);

const serviceActions = entities
    .map((entity) => {
        const status = determineEntityStatus(
            entity,
            now,
            message,
            normalizedSchedules,
            staticPlantStates
        );

        if (status === null || entity.state === status.state) return null;

        return {
            domain: "homeassistant",
            service: `turn_${status.state}`,
            data: { entity_id: entity.entity_id }
        };
    })
    .filter(Boolean)
    .map(serviceToActionCall);

// @ts-ignore
msg.payload = groupActions(serviceActions);
// @ts-ignore
msg.actions = serviceActions;
// @ts-ignore
msg.normalizedSchedules = normalizedSchedules;
