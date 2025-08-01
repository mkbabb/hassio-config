import type { Schedule } from "../types";

// Lock schedules - UNIDIRECTIONAL (only lock, never unlock automatically)
export const lockSchedules: Schedule[] = [
    // Night time auto-lock - lock all doors at bedtime
    {
        name: "night_auto_lock",
        entities: ["lock.front_door", "lock.back_door", "lock.garage_door"],
        start: "23:00",
        precedence: 100,
        type: "trigger", // Trigger once at night
        conditions: [{ type: "state", value: "on", entity_id: "binary_sensor.mike_asleep_status" }],
        defaultStates: {
            // Only define the "on" state - no "off" state means it won't unlock
            on: { state: "locked", service: "lock" }
        }
    },

    // Early morning security check - ensure doors are locked
    {
        name: "early_morning_lock",
        entities: ["lock.front_door", "lock.back_door", "lock.garage_door"],
        start: "04:00",
        precedence: 100,
        type: "trigger", // Trigger once in morning
        conditions: [{ type: "state", value: "on", entity_id: "binary_sensor.mike_asleep_status" }],
        defaultStates: {
            on: { state: "locked", service: "lock" }
        }
    }
];
