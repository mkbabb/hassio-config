import type { Schedule } from "../types";

// Warocqueanum (titanic light) sub-schedules
const warocqueanumSchedules: Schedule[] = [
    {
        name: "warocqueanum_home_morning",
        entities: [
            {
                entity_id: "light.titanic_light",
                states: {
                    on: { service: "turn_on" },
                    off: { service: "turn_off" }
                }
            }
        ],
        tags: ["warocqueanum"],
        start: "06:00",
        end: "10:00",
        precedence: 120,
        conditions: [{ type: "presence", value: "home" }],
        type: "continuous",
        interpolation: { enabled: true, preamble_minutes: 15 }
    },
    {
        name: "warocqueanum_home_midday",
        entities: [
            {
                entity_id: "light.titanic_light",
                states: {
                    on: { service: "turn_on" },
                    off: { service: "turn_off" }
                }
            }
        ],
        tags: ["warocqueanum"],
        start: "12:00",
        end: "14:00",
        precedence: 120,
        conditions: [{ type: "presence", value: "home" }],
        type: "continuous"
    },
    {
        name: "warocqueanum_home_afternoon",
        entities: [
            {
                entity_id: "light.titanic_light",
                states: {
                    on: { service: "turn_on" },
                    off: { service: "turn_off" }
                }
            }
        ],
        tags: ["warocqueanum"],
        start: "16:00",
        end: "18:30",
        precedence: 120,
        conditions: [{ type: "presence", value: "home" }],
        type: "continuous"
    },
    {
        name: "warocqueanum_home_evening",
        entities: [
            {
                entity_id: "light.titanic_light",
                states: {
                    on: { service: "turn_on" },
                    off: { service: "turn_off" }
                }
            }
        ],
        tags: ["warocqueanum"],
        start: "20:00",
        end: "22:00",
        precedence: 120,
        conditions: [{ type: "presence", value: "home" }],
        type: "continuous"
    },
    {
        name: "warocqueanum_away",
        entities: [
            {
                entity_id: "light.titanic_light",
                states: {
                    on: { service: "turn_on" },
                    off: { service: "turn_off" }
                }
            }
        ],
        tags: ["warocqueanum"],
        start: "06:00",
        end: "23:00",
        precedence: 30,
        conditions: [{ type: "presence", value: "away" }],
        type: "continuous" // Keep on when away
    }
];

export const plantSchedules: Schedule[] = [
    // Global plant schedule - affects all grow lights
    {
        name: "plants_global",
        entities: ["regex:(switch|light)\\.(.*grow.*)"],
        start: { entity_id: "input_datetime.plants_global_schedule_start" },
        end: { entity_id: "input_datetime.plants_global_schedule_end" },
        precedence: 100, // HIGH - plants have their own schedule
        type: "continuous" // Enforce state continuously
    },

    // Bedroom plants - tied to dynamic wakeup/sleep schedule
    {
        name: "bedroom_plants",
        entities: ["regex:(switch|light)\\.(.*bedroom.*grow.*)"],
        start: { entity_id: "sensor.wakeup_time" },
        end: { entity_id: "sensor.sleep_time" },
        precedence: 110, // HIGHER - bedroom plants override global
        type: "continuous"
    },

    // Penguin light - specific schedule
    {
        name: "penguin",
        entities: ["light.penguin_light"],
        start: "09:00",
        end: "18:45",
        precedence: 120, // HIGHEST for specific plants
        type: "continuous"
    },

    // Spread the warocqueanum sub-schedules
    ...warocqueanumSchedules
];
