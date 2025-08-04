import { groupActions, filterBlacklistedEntity } from "../utils/utils";
import {
    PresenceState,
    calculateCoolDown,
    isInCoolDownPeriod,
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

// Simple reset handling: only act when we get 'off' after a 'reset'
const prevState = transitionHistory.length > 0 ? transitionHistory[transitionHistory.length - 1].state : 'off';
const inCoolDown = isInCoolDownPeriod(flowInfo);

if (normalizedState === "off" && prevState === "reset") {
    // This is reset→off, turn off lights
    flowInfo.state = PresenceState.OFF;
    flowInfo.lastOff = Date.now();
    flowInfo.lastOn = null;
    flowInfo.delay = 0;
    
    // @ts-ignore
    msg.delay = 1;
    // @ts-ignore
    msg.payload = createPayload(filteredEntities, "turn_off");
} else if (normalizedState === "reset") {
    // Reset state from sensor, just set state but don't act
    flowInfo.state = PresenceState.RESET;
    // @ts-ignore
    msg.payload = null;
} else if (normalizedState === "ignored") {
    // Debounced reset - do nothing
    // @ts-ignore
    msg.payload = null;
} else {
    // Normal state processing
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
            flowInfo.lastOn = Date.now();
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
            const delayMs = calculateCoolDown(dwellTime, coolDown);

            flowInfo.lastOff = Date.now();
            flowInfo.state = PresenceState.PENDING_OFF;
            flowInfo.delay = delayMs;

            // @ts-ignore
            msg.delay = delayMs;
            // @ts-ignore
            msg.payload = createPayload(filteredEntities, "turn_off");
        } else if (prevState === PresenceState.UNKNOWN && !inCoolDown) {
            // From unknown to off, no cool-down active
            flowInfo.state = PresenceState.OFF;
            flowInfo.lastOff = Date.now();
            flowInfo.lastOn = null;
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
}

// Update transition history
transitionHistory.push({ state: flowInfo.state, time: Date.now() });
if (transitionHistory.length > 10) {
    transitionHistory = transitionHistory.slice(-10);
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
msg.debug = {
    topic: topic,
    sensorCount: Object.keys(presenceStates).length,
    coolDownSeconds: coolDown,
    // @ts-ignore
    actualDelayMs: msg.delay,
    currentState: flowInfo.state,
    transitionHistory: transitionHistory.slice(-3), // Last 3 transitions
    timeSinceLastOn: flowInfo.lastOn ? Date.now() - flowInfo.lastOn : null,
    timeSinceLastOff: flowInfo.lastOff ? Date.now() - flowInfo.lastOff : null,
    resetHandled: normalizedState === "reset" || (normalizedState === "off" && prevState === "reset")
};
