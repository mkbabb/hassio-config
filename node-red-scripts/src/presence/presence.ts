import { groupActions, filterBlacklistedEntity } from "../utils/utils";
import {
    MAX_COOL_DOWN,
    DEFAULT_COOL_DOWN,
    DEBOUNCE_TIME_MS,
    IMMEDIATE_DELAY_MS,
    PresenceState,
    calculateCoolDown
} from "./utils";

// Unified payload creator to follow DRY principle
const createPayload = (entities: Hass.State[], action: "turn_on" | "turn_off") => {
    const actions: Partial<Hass.Service & Hass.Action>[] = entities.map((e) => ({
        action: `homeassistant.${action}`,
        target: { entity_id: e.entity_id }
    }));
    return groupActions(actions);
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
const state = message.state; // State of the sensor
const data = message.data;
const dataEntityId = data.entity_id;
const topic: string = message.topic ?? dataEntityId;
const coolDown = message.coolDown ?? DEFAULT_COOL_DOWN;


// Filter entities - handle both strings and objects
const rawEntities = message.entities
    ? (Array.isArray(message.entities) ? message.entities : [message.entities])
    : [];

// If no entities provided, try to infer from topic (e.g., guest_bathroom → light.guest_bathroom_light)
if (rawEntities.length === 0 && topic && topic !== dataEntityId) {
    // Common pattern: topic like "guest_bathroom" maps to "light.guest_bathroom_light"
    const inferredLight = `light.${topic.replace(/_/g, '_')}_light`;
    rawEntities.push(inferredLight);
}

// Convert string entity IDs to objects if needed
const entities: Hass.State[] = rawEntities.map(e =>
    typeof e === 'string' ? { entity_id: e, state: 'unknown' } as Hass.State : e
);

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

// Handle reset commands
const isReset = ["reset", "reset_on", "reset_off"].includes(state);
if (isReset) {
    const action = state === "reset_on" ? "turn_on" : "turn_off";
    const targetState = state === "reset_on" ? PresenceState.ON : PresenceState.OFF;

    // Reset flow state
    Object.assign(flowInfo, {
        state: targetState,
        prevState: targetState,
        prevPrevState: targetState,
        lastOn: state === "reset_on" ? Date.now() : null,
        lastOff: state === "reset_off" ? Date.now() : null,
        delay: 0
    });

    presenceStates = {};
    // @ts-ignore
    flow.set(presenceStatesKey, presenceStates);
    // @ts-ignore
    flow.set(flowInfoKey, flowInfo);

    // @ts-ignore
    msg.payload = createPayload(filteredEntities, action);
    // @ts-ignore
    msg.delay = IMMEDIATE_DELAY_MS;
    // @ts-ignore
    msg.presenceState = flowInfo.state;
    // @ts-ignore
    msg.topic = topic;
}

// Validate and normalize the incoming sensor state
const normalizedState = !isReset ? (state === "on" || state === "off" ? state : "unknown") : "";

// Process normal sensor state changes (not reset commands)
if (!isReset) {
    // Simple debouncing - ignore rapid state changes
    const now = Date.now();
    const timeSinceLastUpdate = now - debounceInfo.lastUpdate;

    // Check if this is a rapid state change
if (
    timeSinceLastUpdate < DEBOUNCE_TIME_MS &&
    presenceStates[dataEntityId] !== normalizedState
) {
    // Store pending state but don't process yet
    debounceInfo.pendingState = normalizedState;
    debounceInfo.lastUpdate = now;
    // @ts-ignore
    flow.set(debounceKey, debounceInfo);
    // Exit early - no state change, return empty message
    // @ts-ignore
    msg.payload = null;
    // @ts-ignore
    msg.delay = IMMEDIATE_DELAY_MS;
} else {
    // Update the specific sensor's state
    presenceStates[dataEntityId] = normalizedState;
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
    const isProblematicSequence = isOnUnknownOffSequence(
        aggregateState,
        prevState,
        prevPrevState
    );

    // Determine actual state considering cool-down
    let actualState = aggregateState;
    if (aggregateState === PresenceState.OFF && inCoolDown) {
        actualState = PresenceState.PENDING_OFF;
    }

    // Initialize output
    // @ts-ignore
    msg.delay = IMMEDIATE_DELAY_MS;
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
                flowInfo.coolDownEndTime = null; // Clear cooldown end time
                // Don't update lastOn - maintain dwell time calculation
                // Send turn_on to ensure lights stay on (counteract any pending turn_off)
                // @ts-ignore
                msg.payload = createPayload(filteredEntities, "turn_on");
                // @ts-ignore
                msg.delay = IMMEDIATE_DELAY_MS; // Immediate action
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
                // calculateCoolDown already returns milliseconds
                const delayMs = calculateCoolDown(dwellTime, coolDown);

                flowInfo.lastOff = Date.now();
                flowInfo.state = PresenceState.PENDING_OFF;
                flowInfo.delay = delayMs;
                flowInfo.coolDownEndTime = Date.now() + delayMs; // Set cooldown end time

                // @ts-ignore
                msg.delay = delayMs;
                // @ts-ignore
                msg.payload = createPayload(filteredEntities, "turn_off");
            } else if (
                prevState === PresenceState.UNKNOWN &&
                !inCoolDown &&
                !isProblematicSequence
            ) {
                // From unknown to off, no cool-down active, not problematic sequence
                flowInfo.state = PresenceState.OFF;
                flowInfo.lastOff = Date.now();
                flowInfo.lastOn = null;
                flowInfo.coolDownEndTime = null;
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
    msg.topic = topic; // Ensure topic is passed through
    // @ts-ignore
    msg.inCoolDown = inCoolDown;
    // @ts-ignore
    msg.debug = {
        topic: topic,
        sensorCount: Object.keys(presenceStates).length,
        coolDownSeconds: coolDown,
        // @ts-ignore
        actualDelayMs: msg.delay,
        stateTransition: `${prevState} → ${flowInfo.state}`,
        timeSinceLastOn: flowInfo.lastOn ? Date.now() - flowInfo.lastOn : null,
        timeSinceLastOff: flowInfo.lastOff ? Date.now() - flowInfo.lastOff : null,
        // Debounce info
        // @ts-ignore
        debounceInfo: {
            lastUpdate: debounceInfo.lastUpdate,
            pendingState: debounceInfo.pendingState
        }
    };

} // End of else block for debounce check
} // End of !isReset block
