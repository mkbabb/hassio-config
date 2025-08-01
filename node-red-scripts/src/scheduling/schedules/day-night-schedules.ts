import type { Schedule } from "../types";

export const dayNightSchedules: Schedule[] = [
    // Day status - set to "day" at wakeup, "night" at sleep
    {
        name: "day_status",
        entities: ["input_select.day_status"],
        start: { entity_id: "sensor.wakeup_time" }, // Template sensor
        end: { entity_id: "sensor.sleep_time" }, // Template sensor
        precedence: 50,
        type: "continuous", // Keep state until next change
        interpolation: {
            enabled: true,
            preamble_minutes: 60, // 1 hour sunrise simulation
            postamble_minutes: 60, // 1 hour sunset simulation
            events: true
        },
        defaultStates: {
            on: {
                state: "day",
                service: "select_option",
                domain: "input_select",
                data: { option: "day" }
            },
            off: {
                state: "night", 
                service: "select_option",
                domain: "input_select",
                data: { option: "night" }
            }
        }
    }
];
