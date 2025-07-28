const MAX_COOL_DOWN = 30 * 60; // 30 minutes max cool-down
export const DEFAULT_COOL_DOWN = 10 * 60; // 10 minutes for debugging (was 10 * 60)

// States for the presence state machine
export enum PresenceState {
    OFF = "off",
    ON = "on",
    UNKNOWN = "unknown",
    PENDING_OFF = "pending_off" // New state for cool-down period
}

// Calculate exponential backoff with gentler curve
// Returns the cool-down time in milliseconds
export const calculateCoolDown = (
    dwellTimeMs: number,
    baseCoolDown: number
): number => {
    const minutesDwelled = Math.floor(dwellTimeMs / (60 * 1000));
    // Use square root for gentler curve: base + sqrt(minutes) * 120
    const additionalDelay = Math.sqrt(minutesDwelled) * 120;

    const coolDownSeconds = baseCoolDown + additionalDelay;

    return Math.min(MAX_COOL_DOWN, coolDownSeconds) * 1000; // Convert to milliseconds
};

// Check if we're in a cool-down period
export const isInCoolDownPeriod = (flowInfo: any): boolean => {
    if (!flowInfo.delay || !flowInfo.lastOff) {
        return false;
    }
    const timeSinceLastOff = Date.now() - flowInfo.lastOff;
    return timeSinceLastOff < flowInfo.delay;
};

// Calculate remaining cooldown time in milliseconds
export const getRemainingCoolDownMs = (flowInfo: any): number => {
    if (!isInCoolDownPeriod(flowInfo)) {
        return 0;
    }
    const timeSinceLastOff = Date.now() - flowInfo.lastOff;
    return flowInfo.delay - timeSinceLastOff;
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

// Check if we have the on→unknown→off sequence
export const isOnUnknownOffSequence = (
    currentState: PresenceState,
    prevState: PresenceState,
    prevPrevState: PresenceState
): boolean => {
    return (
        prevPrevState === PresenceState.ON &&
        prevState === PresenceState.UNKNOWN &&
        currentState === PresenceState.OFF
    );
};
