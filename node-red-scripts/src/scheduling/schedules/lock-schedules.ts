import type { Schedule } from "../types";

// Lock schedules - UNIDIRECTIONAL (only lock, never unlock automatically)
export const lockSchedules: Schedule[] = [
    // Night time auto-lock - lock all doors at bedtime
    {
        name: "night_auto_lock",
        entities: [
            /lock\..*/,  // All locks
            "lock.front_door",
            "lock.back_door",
            "lock.garage_door"
        ],
        start: "23:00",
        end: "23:01",  // Only active for 1 minute to trigger lock
        precedence: 100,
        defaultStates: {
            // Only define the "on" state - no "off" state means it won't unlock
            on: { state: "locked", service: "lock" }
            // Intentionally no "off" state - prevents automatic unlocking
        }
    },
    
    // Early morning security check - ensure doors are locked
    {
        name: "early_morning_lock",
        entities: [
            /lock\..*/,
            "lock.front_door",
            "lock.back_door",
            "lock.garage_door"
        ],
        start: "04:00",
        end: "04:01",  // Only active for 1 minute
        precedence: 100,
        defaultStates: {
            on: { state: "locked", service: "lock" }
            // No "off" state - unidirectional
        }
    },
    
    // Away mode - lock when nobody home
    {
        name: "away_lock",
        entities: [
            /lock\..*/
        ],
        start: "00:00",
        end: "23:59",  // Always active when away
        precedence: 110,
        conditions: [
            { type: "presence", value: "away" }
        ],
        defaultStates: {
            on: { state: "locked", service: "lock" }
            // No "off" state - unidirectional
        }
    }
];

// Important: These schedules are designed to ONLY lock doors, never unlock them
// Unlocking should only happen through:
// 1. Manual control (physical key, app, dashboard)
// 2. Specific automations (like presence detection when arriving home)
// 3. Voice commands or other explicit user actions