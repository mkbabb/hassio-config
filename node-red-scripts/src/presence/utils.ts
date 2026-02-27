// Time constants (in seconds unless specified)
export const MAX_COOL_DOWN = 20 * 60; // 20 minutes max cool-down
export const DEFAULT_COOL_DOWN = 10 * 60; // 10 minutes default cool-down
export const DEBOUNCE_TIME_MS = 1000; // 1 second debounce window (in milliseconds)
export const IMMEDIATE_DELAY_MS = 1; // 1ms for immediate actions (in milliseconds)
export const TEST_WAIT_MS = 2000; // 2 seconds standard wait time for tests (in milliseconds)

// States for the presence state machine
export enum PresenceState {
    OFF = "off",
    ON = "on",
    UNKNOWN = "unknown",
    PENDING_OFF = "pending_off" // Cool-down period before turning off
}

// Calculate cooldown with linear ramp and hard cap.
// Short visits (~5min) get base cooldown (10min).
// Longer visits ramp linearly: +1s per minute dwelled, capped at MAX_COOL_DOWN.
// Returns the cool-down time in milliseconds.
export const calculateCoolDown = (
    dwellTimeMs: number,
    baseCoolDown: number
): number => {
    const minutesDwelled = Math.floor(dwellTimeMs / (60 * 1000));
    // Linear: base + min(dwellMinutes, 60) * 10 seconds
    // 5min dwell → base + 50s, 30min → base + 300s, 60min+ → base + 600s
    const additionalDelay = Math.min(minutesDwelled, 60) * 10;

    const coolDownSeconds = baseCoolDown + additionalDelay;

    return Math.min(MAX_COOL_DOWN, coolDownSeconds) * 1000; // Convert to milliseconds
};

// Check if we're in a cool-down period
export const isInCoolDownPeriod = (flowInfo: any): boolean => {
    if (!flowInfo.coolDownEndTime) {
        return false;
    }
    return Date.now() < flowInfo.coolDownEndTime;
};

// Calculate remaining cooldown time in milliseconds
export const getRemainingCoolDownMs = (flowInfo: any): number => {
    if (!flowInfo.coolDownEndTime) {
        return 0;
    }
    const remaining = flowInfo.coolDownEndTime - Date.now();
    return remaining > 0 ? remaining : 0;
};

// Determine aggregate presence state from multiple sensors
export const determinePresenceState = (sensorStates: string[]): PresenceState => {
    // If all sensors are unknown, state is unknown
    if (
        sensorStates.every(
            (state) => state === "unknown" || state === "unavailable" || !state
        )
    ) {
        return PresenceState.UNKNOWN;
    }
    // If any sensor is on, presence is detected
    if (sensorStates.some((state) => state === "on")) {
        return PresenceState.ON;
    }
    // All sensors are off
    return PresenceState.OFF;
};

// Note: Problematic sequence detection moved to reset-handler.ts
