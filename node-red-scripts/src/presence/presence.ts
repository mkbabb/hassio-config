import { groupActions, filterBlacklistedEntity } from "../utils/utils";
import {
    PresenceState,
    calculateCoolDown,
    isInCoolDownPeriod,
    getRemainingCoolDownMs,
    determinePresenceState,
    DEFAULT_COOL_DOWN
} from "./utils";

// Unified payload creator to follow DRY principle
const createPayload = (entities: Hass.State[], action: "turn_on" | "turn_off") => {
    const actions: Partial<Hass.Service & Hass.Action>[] = entities.map((e) => ({
        action: `homeassistant.${action}`,
        target: { entity_id: e.entity_id }
    }));
    return groupActions(actions);
};

// @ts-ignore
const message = msg;

// Extract message properties
const state = message.state; // State of the sensor
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
const historyKey = `transitionHistory.${topic}`;

// Initialize presence states if needed
// @ts-ignore
let presenceStates: Record<string, string> = flow.get(presenceStatesKey) || {};
// @ts-ignore
flow.set(presenceStatesKey, presenceStates);

// Initialize flow info if needed
// @ts-ignore
let flowInfo = flow.get(flowInfoKey) || {
    state: PresenceState.OFF,
    lastOn: null,
    lastOff: null,
    coolDownEndTime: null,
    delay: 0
};

// Get transition history (last 10 transitions)
// @ts-ignore
let transitionHistory = flow.get(historyKey) || [];

// Validate and normalize the incoming sensor state
// Handle 'reset' and 'ignored' states from debouncer
const normalizedState = state === "on" || state === "off" || state === "reset" || state === "ignored" ? state : "unknown";

// Update the specific sensor's state
presenceStates[dataEntityId] = normalizedState;

// Determine aggregate presence state
const presenceStatesValues = Object.values(presenceStates);
const aggregateState = determinePresenceState(presenceStatesValues);

// Get previous state for transitions
const prevState = flowInfo.state || PresenceState.OFF;
const inCoolDown = isInCoolDownPeriod(flowInfo);

if (normalizedState === "reset" || normalizedState === "ignored") {
    // Reset or ignored states - maintain current state
    // @ts-ignore
    msg.payload = null;
    // @ts-ignore
    msg.delay = 1;
} else {
    // Determine target state based on sensors and cooldown
    let targetState = aggregateState;
    
    // If sensors say OFF but we're in cooldown, stay in PENDING_OFF
    if (aggregateState === PresenceState.OFF && inCoolDown) {
        targetState = PresenceState.PENDING_OFF;
    }

    // Initialize output
    // @ts-ignore
    msg.delay = 1;
    // @ts-ignore
    msg.payload = null;

    // State machine logic
    switch (targetState) {
    case PresenceState.ON:
        if (prevState !== PresenceState.ON) {
            // Transition to ON from any other state
            flowInfo.lastOn = Date.now();
            flowInfo.state = PresenceState.ON;
            flowInfo.coolDownEndTime = null;  // Clear cooldown
            flowInfo.delay = 0;
            
            // Cancel any pending off commands
            if (prevState === PresenceState.PENDING_OFF) {
                // @ts-ignore
                msg.reset = true;
            }
            
            // @ts-ignore
            msg.payload = createPayload(filteredEntities, "turn_on");
        }
        // If already ON, do nothing
        break;

    case PresenceState.OFF:
        if (prevState === PresenceState.ON) {
            // Start cool-down period when transitioning from ON to OFF
            const dwellTime = flowInfo.lastOn ? Date.now() - flowInfo.lastOn : 0;
            const delayMs = calculateCoolDown(dwellTime, coolDown);

            flowInfo.lastOff = Date.now();
            flowInfo.state = PresenceState.PENDING_OFF;
            flowInfo.coolDownEndTime = Date.now() + delayMs;
            flowInfo.delay = delayMs;

            // @ts-ignore
            msg.delay = delayMs;
            // @ts-ignore
            msg.payload = createPayload(filteredEntities, "turn_off");
        } else if (prevState === PresenceState.PENDING_OFF && !inCoolDown) {
            // Cooldown expired, transition to OFF
            flowInfo.state = PresenceState.OFF;
            flowInfo.coolDownEndTime = null;
            flowInfo.lastOn = null;
            flowInfo.delay = 0;
            // No action needed, lights already turned off
        } else if (prevState === PresenceState.UNKNOWN) {
            // From unknown to off
            flowInfo.state = PresenceState.OFF;
            flowInfo.lastOff = Date.now();
            flowInfo.lastOn = null;
            flowInfo.coolDownEndTime = null;
            // @ts-ignore
            msg.payload = createPayload(filteredEntities, "turn_off");
        }
        // If already OFF, do nothing
        break;

    case PresenceState.PENDING_OFF:
        // Still in cool-down period - maintain state
        if (!inCoolDown) {
            // Cooldown has expired, transition to OFF
            flowInfo.state = PresenceState.OFF;
            flowInfo.coolDownEndTime = null;
            flowInfo.lastOn = null;
            flowInfo.delay = 0;
        }
        // No action during pending_off
        break;

    case PresenceState.UNKNOWN:
        // Set state but don't control entities
        flowInfo.state = PresenceState.UNKNOWN;
        break;
    }
}

// Update transition history (only if state changed)
if (flowInfo.state !== prevState) {
    transitionHistory.push({ state: flowInfo.state, time: Date.now() });
    if (transitionHistory.length > 10) {
        transitionHistory = transitionHistory.slice(-10);
    }
}

// Update flow context
// @ts-ignore
flow.set(flowInfoKey, flowInfo);
// @ts-ignore
flow.set(presenceStatesKey, presenceStates);
// @ts-ignore
flow.set(historyKey, transitionHistory);

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
// @ts-ignore
msg.coolDownRemaining = isInCoolDownPeriod(flowInfo) ? getRemainingCoolDownMs(flowInfo) : 0;
// @ts-ignore
msg.debug = msg.debug || {}; // Preserve any existing debug info
// @ts-ignore
Object.assign(msg.debug, {
    topic: topic,
    sensorCount: Object.keys(presenceStates).length,
    coolDownSeconds: coolDown,
    // @ts-ignore
    actualDelayMs: msg.delay,
    currentState: flowInfo.state,
    stateTransition: transitionHistory.length > 0 ? 
        `${transitionHistory[transitionHistory.length - 1]?.state || 'unknown'} → ${flowInfo.state}` : 
        `unknown → ${flowInfo.state}`,
    transitionHistory: transitionHistory.slice(-10), // Last 10 transitions for full history
    timeSinceLastOn: flowInfo.lastOn ? Date.now() - flowInfo.lastOn : null,
    timeSinceLastOff: flowInfo.lastOff ? Date.now() - flowInfo.lastOff : null,
    resetHandled: normalizedState === "reset" || (normalizedState === "off" && prevState === "reset"),
    normalizedState: normalizedState,
    prevState: prevState,
    sequenceType: normalizedState === "reset" ? "reset" : 
                 normalizedState === "ignored" ? "debounced" : "normal",
    // State machine behavior flags
    wasPendingOffTreatedAsOff: (flowInfo.state === PresenceState.ON && prevState === PresenceState.PENDING_OFF),
    coolDownCancelled: (flowInfo.state === PresenceState.ON && prevState === PresenceState.PENDING_OFF)
});
