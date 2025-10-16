import type { Schedule } from "../types";

// Blinds open during day, close at sunset
// These are sub-schedules of day/night
export const blindsSchedules: Schedule[] = [
    // Open/close blinds with wakeup and sleep times
    {
        name: "blinds_day_schedule",
        entities: ["regex:cover\\..*blind.*", "regex:cover\\..*shade.*"],
        start: { entity_id: "sensor.wakeup_time" },
        end: { entity_id: "sensor.sunset" },
        precedence: 70, // Higher than day/night base schedules
        type: "trigger", // Trigger once for blinds
        defaultStates: {
            on: {
                state: "open",
                service: "set_cover_position",
                data: { position: 3 }
            },
            off: { state: "closed", service: "close_cover" }
        }
    },
    // Inverse schedule to ensure blinds are ALWAYS closed at night
    {
        name: "blinds_night_schedule",
        entities: ["regex:cover\\..*blind.*", "regex:cover\\..*shade.*"],
        start: { entity_id: "sensor.sunset" },
        end: { entity_id: "sensor.wakeup_time" },
        precedence: 71, // Higher than day schedule to take priority at night
        type: "continuous",
        defaultStates: {
            on: { state: "closed", service: "close_cover" },
            off: { state: "open", service: "set_cover_position", data: { position: 3 } }
        }
    }
];
