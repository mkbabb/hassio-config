import { groupActions, filterBlacklistedEntity } from "../utils/utils";

const MAX_COOL_DOWN = 30 * 60; // 30 minutes max cool-down
const DEFAULT_COOL_DOWN = 10 * 60; // 10 minutes

// States for the presence state machine
enum PresenceState {
    OFF = "off",
    ON = "on",
    UNKNOWN = "unknown",
    PENDING_OFF = "pending_off" // New state for cool-down period
}

// Unified payload creator to follow DRY principle
const createPayload = (entities: Hass.State[], action: "turn_on" | "turn_off") => {
    const actions: Partial<Hass.Service & Hass.Action>[] = entities.map((e) => ({
        action: `homeassistant.${action}`,
        target: { entity_id: e.entity_id }
    }));
    return groupActions(actions);
};

// Calculate exponential backoff with gentler curve
const calculateCoolDown = (dwellTimeMs: number, baseCoolDown: number): number => {
    const minutesDwelled = Math.floor(dwellTimeMs / 60000);
    // Use square root for gentler curve: base + sqrt(minutes) * 120
    const additionalDelay = Math.sqrt(minutesDwelled) * 120;
    return Math.min(MAX_COOL_DOWN, baseCoolDown + additionalDelay);
};

// Check if we're in a cool-down period
const isInCoolDownPeriod = (flowInfo: any): boolean => {
    if (!flowInfo.delay || !flowInfo.lastOff) {
        return false;
    }
    const timeSinceLastOff = Date.now() - flowInfo.lastOff;
    return timeSinceLastOff < flowInfo.delay;
};

// Determine aggregate presence state from multiple sensors
const determinePresenceState = (sensorStates: string[]): PresenceState => {
    // If any sensor is unknown, state is unknown
    if (
        sensorStates.some(
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
const isOnUnknownOffSequence = (
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

// @ts-ignore
const message = msg;

// Extract message properties
const payload = message.payload;
const data = message.data;
const dataEntityId = data.entity_id;
const topic: string = message.topic ?? dataEntityId;
const coolDown = message.coolDown ?? DEFAULT_COOL_DOWN;

// Filter entities
const entities: Hass.State[] = Array.isArray(message.entities)
    ? message.entities
    : [message.entities];
const filteredEntities = entities.filter((e) => filterBlacklistedEntity(e));

// Flow context keys
const presenceStatesKey = `presenceStates.${topic}`;
const flowInfoKey = `flowInfo.${topic}`;
const debounceKey = `debounce.${topic}`;

// Initialize presence states if needed
// @ts-ignore
let presenceStates: Record<string, string> = flow.get(presenceStatesKey) || {};
// @ts-ignore
flow.set(presenceStatesKey, presenceStates);

// Initialize flow info if needed
// @ts-ignore
let flowInfo = flow.get(flowInfoKey) || {
    state: PresenceState.OFF,
    prevState: PresenceState.OFF,
    prevPrevState: PresenceState.OFF,
    lastOn: null,
    lastOff: null,
    delay: 0
};

// Initialize debounce tracking
// @ts-ignore
let debounceInfo = flow.get(debounceKey) || {
    lastUpdate: 0,
    pendingState: null
};

// Validate and normalize the incoming sensor state
const normalizedPayload = payload === "on" || payload === "off" ? payload : "unknown";

// Simple debouncing - ignore rapid state changes within 2 seconds
const DEBOUNCE_TIME = 2000; // 2 seconds
const now = Date.now();
const timeSinceLastUpdate = now - debounceInfo.lastUpdate;

// Check if this is a rapid state change
if (
    timeSinceLastUpdate < DEBOUNCE_TIME &&
    presenceStates[dataEntityId] !== normalizedPayload
) {
    // Store pending state but don't process yet
    debounceInfo.pendingState = normalizedPayload;
    debounceInfo.lastUpdate = now;
    // @ts-ignore
    flow.set(debounceKey, debounceInfo);
    // Exit early - no state change, return empty message
    // @ts-ignore
    msg.payload = null;
    // @ts-ignore
    msg.delay = 1;
} else {
    // Update the specific sensor's state
    presenceStates[dataEntityId] = normalizedPayload;
    debounceInfo.lastUpdate = now;
    debounceInfo.pendingState = null;

    // Determine aggregate presence state
    const presenceStatesValues = Object.values(presenceStates);
    const aggregateState = determinePresenceState(presenceStatesValues);

    // Get previous states
    const prevState = flowInfo.state as PresenceState;
    const prevPrevState = flowInfo.prevState as PresenceState;

    // Check if we're in cool-down period
    const inCoolDown = isInCoolDownPeriod(flowInfo);

    // Check for on→unknown→off sequence
    const isProblematicSequence = isOnUnknownOffSequence(aggregateState, prevState, prevPrevState);

    // Determine actual state considering cool-down
    let actualState = aggregateState;
    if (aggregateState === PresenceState.OFF && inCoolDown) {
        actualState = PresenceState.PENDING_OFF;
    }

    // Initialize output
    // @ts-ignore
    msg.delay = 1;
    // @ts-ignore
    msg.payload = null;

    // State machine logic - simplified and clear
    switch (actualState) {
        case PresenceState.ON:
            if (prevState === PresenceState.OFF) {
                // Transition from OFF to ON
                flowInfo.lastOn = Date.now();
                flowInfo.lastOff = null;
                flowInfo.state = PresenceState.ON;
                flowInfo.delay = 0;
                // @ts-ignore
                msg.payload = createPayload(filteredEntities, "turn_on");
            } else if (prevState === PresenceState.PENDING_OFF) {
                // Cancel pending off - presence detected during cool-down
                flowInfo.state = PresenceState.ON;
                flowInfo.lastOff = null;
                flowInfo.delay = 0;
                // Don't update lastOn - maintain dwell time calculation
            } else if (prevState === PresenceState.UNKNOWN && !inCoolDown) {
                // Recover from unknown to on, no cool-down active
                flowInfo.state = PresenceState.ON;
                if (!flowInfo.lastOn) {
                    flowInfo.lastOn = Date.now();
                }
                // @ts-ignore
                msg.payload = createPayload(filteredEntities, "turn_on");
            }
            // If already ON, do nothing (no payload)
            break;

        case PresenceState.OFF:
            if (prevState === PresenceState.ON && !inCoolDown) {
                // Start cool-down period
                const dwellTime = flowInfo.lastOn ? Date.now() - flowInfo.lastOn : 0;
                const delaySeconds = calculateCoolDown(dwellTime, coolDown);
                const delayMs = delaySeconds * 1000;

                flowInfo.lastOff = Date.now();
                flowInfo.state = PresenceState.PENDING_OFF;
                flowInfo.delay = delayMs;

                // @ts-ignore
                msg.delay = delayMs;
                // @ts-ignore
                msg.payload = createPayload(filteredEntities, "turn_off");
            } else if (prevState === PresenceState.UNKNOWN && !inCoolDown && !isProblematicSequence) {
                // From unknown to off, no cool-down active, not problematic sequence
                flowInfo.state = PresenceState.OFF;
                flowInfo.lastOff = Date.now();
                flowInfo.lastOn = null;
                // @ts-ignore
                msg.payload = createPayload(filteredEntities, "turn_off");
            } else if (isProblematicSequence) {
                // On→Unknown→Off sequence detected - skip instant off, just update state
                flowInfo.state = PresenceState.OFF;
            }
            // If already OFF or in cool-down, do nothing
            break;

        case PresenceState.PENDING_OFF:
            // In cool-down period - maintain state
            flowInfo.state = PresenceState.PENDING_OFF;
            break;

        case PresenceState.UNKNOWN:
            // Set state but don't control entities
            flowInfo.state = PresenceState.UNKNOWN;
            break;
    }

    // Update state history before saving
    flowInfo.prevPrevState = flowInfo.prevState;
    flowInfo.prevState = prevState;

    // Update flow context
    // @ts-ignore
    flow.set(flowInfoKey, flowInfo);
    // @ts-ignore
    flow.set(presenceStatesKey, presenceStates);
    // @ts-ignore
    flow.set(debounceKey, debounceInfo);

    // Add debug information to message
    // @ts-ignore
    msg.presenceStates = presenceStates;
    // @ts-ignore
    msg.presenceState = flowInfo.state;
    // @ts-ignore
    msg.flowInfo = flowInfo;
    // @ts-ignore
    msg.aggregateState = aggregateState;
    // @ts-ignore
    msg.inCoolDown = inCoolDown;
} // End of else block for debounce check
