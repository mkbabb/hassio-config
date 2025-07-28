import type { Schedule } from "../types";

// Blinds open during day, close at sunset
// These are sub-schedules of day/night
export const blindsSchedules: Schedule[] = [
    // Open/close blinds with wakeup and sleep times
    {
        name: "blinds_day_schedule",
        entities: [
            "regex:cover\\..*blind.*",
            "regex:cover\\..*shade.*",
            "cover.living_room_blinds",
            "cover.bedroom_blinds",
            "cover.office_blinds"
        ],
        start: { entity_id: "input_datetime.weekday_wakeup" },
        end: { entity_id: "input_datetime.weekday_sleep" },
        precedence: 70,  // Higher than day/night base schedules
        type: "trigger",  // Only trigger at start/end times
        defaultStates: {
            on: { state: "open", service: "open_cover" },
            off: { state: "closed", service: "close_cover" }
        }
    },
    
    
    // Privacy mode - close specific blinds during certain hours
    {
        name: "privacy_blinds",
        entities: [
            "cover.bathroom_blinds",
            "cover.bedroom_blinds"
        ],
        start: "20:00",
        end: "07:00",
        precedence: 90,  // Highest priority for privacy
        type: "trigger",  // Only trigger at transitions
        defaultStates: {
            on: { state: "closed", service: "close_cover" },
            off: { state: "open", service: "open_cover" }
        }
    }
];