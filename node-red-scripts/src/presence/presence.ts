import { filterBlacklistedEntity } from "../utils/utils";
import { groupActions } from "../utils/service-calls";
import { getEntity } from "../utils/entities";
import {
    MAX_COOL_DOWN,
    DEFAULT_COOL_DOWN,
    DEBOUNCE_TIME_MS,
    IMMEDIATE_DELAY_MS,
    PresenceState,
    calculateCoolDown
} from "./utils";
import type { PresenceAreaConfig, PresenceRegistry } from "./types";
import { getSensorEntityId, normalizeSensorConfig, sensorMatchesEntity } from "./types";

// Check if all presence conditions are met for an area (all must pass)
const checkPresenceConditions = (area: PresenceAreaConfig | undefined): boolean => {
    if (!area?.conditions || area.conditions.length === 0) return true;
    return area.conditions.every(c => {
        const entity = getEntity(c.entity_id);
        if (!entity) return false;
        const states = Array.isArray(c.state) ? c.state : [c.state];
        return states.includes(entity.state);
    });
};

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

// Registry-based area lookup: if msg.topic is not explicitly set by upstream wiring,
// look up the area from the presence registry based on the triggering sensor.
// @ts-ignore
const presenceRegistry: PresenceRegistry | undefined = global.get("presenceRegistry");
const registryArea = presenceRegistry
    ? Object.values(presenceRegistry.areas).find(a =>
        a.enabled && a.sensors.some(s => sensorMatchesEntity(s, dataEntityId))
    )
    : undefined;

// Topic resolution: prefer msg.topic (upstream wiring), fall back to registry, then entity_id
const topic: string = message.topic ?? registryArea?.topic ?? dataEntityId;

// Cooldown: prefer msg.coolDown (upstream wiring), then registry, then default
const coolDown = message.coolDown ?? registryArea?.coolDown ?? DEFAULT_COOL_DOWN;


// Filter entities - handle both strings and objects
// Prefer msg.entities (backward compat with per-room wiring), fall back to registry
let rawEntities: any[] = message.entities
    ? (Array.isArray(message.entities) ? message.entities : [message.entities])
    : [];

// If no entities from msg, try registry
if (rawEntities.length === 0 && registryArea && registryArea.entities.length > 0) {
    rawEntities = registryArea.entities.map(e => e.entity_id);
}

// If still no entities, try to infer from topic (e.g., guest_bathroom → light.guest_bathroom_light)
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

// Check presence conditions — if not met, DFA still updates but no entity actions are sent
const conditionsMet = checkPresenceConditions(registryArea);

// Global context keys (accessible from API endpoints and publishers on other tabs)
const presenceStatesKey = `presenceStates.${topic}`;
const flowInfoKey = `presenceFlowInfo.${topic}`;
const debounceKey = `presenceDebounce.${topic}`;

// Initialize presence states if needed (global context for cross-tab access)
// @ts-ignore
let presenceStates: Record<string, string> = global.get(presenceStatesKey) || {};
// @ts-ignore
global.set(presenceStatesKey, presenceStates);

// Initialize flow info if needed (global context for API/publisher access)
// @ts-ignore
let flowInfo = global.get(flowInfoKey) || {
    state: PresenceState.OFF,
    prevState: PresenceState.OFF,
    prevPrevState: PresenceState.OFF,
    lastOn: null,
    lastOff: null,
    delay: 0
};

// Initialize debounce tracking (global context for consistency)
// @ts-ignore
let debounceInfo = global.get(debounceKey) || {
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
    global.set(presenceStatesKey, presenceStates);
    // @ts-ignore
    global.set(flowInfoKey, flowInfo);

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
    global.set(debounceKey, debounceInfo);
    // Exit early - no state change, return empty message
    // @ts-ignore
    msg.payload = null;
    // @ts-ignore
    msg.delay = IMMEDIATE_DELAY_MS;
} else {
    // Update the specific sensor's state (edge sensors still record changes to trigger DFA)
    presenceStates[dataEntityId] = normalizedState;
    debounceInfo.lastUpdate = now;
    debounceInfo.pendingState = null;

    // Resolve sensor configs for edge-trigger filtering
    const sensorConfigs = registryArea?.sensors.map(s => normalizeSensorConfig(s)) ?? [];

    // For aggregate state, only include "level" sensors (edge sensors trigger DFA but don't sustain presence)
    const levelSensorStates = Object.entries(presenceStates)
        .filter(([id]) => {
            const cfg = sensorConfigs.find(s => s.entity_id === id);
            return !cfg || cfg.triggerMode !== "edge";
        })
        .map(([, state]) => state);

    // Determine aggregate presence state (only from level sensors)
    const aggregateState = determinePresenceState(
        levelSensorStates.length > 0 ? levelSensorStates : Object.values(presenceStates)
    );

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
    // Note: DFA state always updates; entity actions gated by conditionsMet
    switch (actualState) {
        case PresenceState.ON:
            if (prevState === PresenceState.OFF) {
                // Transition from OFF to ON
                flowInfo.lastOn = Date.now();
                flowInfo.lastOff = null;
                flowInfo.state = PresenceState.ON;
                flowInfo.delay = 0;
                // @ts-ignore
                if (conditionsMet) msg.payload = createPayload(filteredEntities, "turn_on");
            } else if (prevState === PresenceState.PENDING_OFF) {
                // Cancel pending off - presence detected during cool-down
                flowInfo.state = PresenceState.ON;
                flowInfo.lastOff = null;
                flowInfo.delay = 0;
                flowInfo.coolDownEndTime = null; // Clear cooldown end time
                // Don't update lastOn - maintain dwell time calculation
                // Send turn_on to ensure lights stay on (counteract any pending turn_off)
                // @ts-ignore
                if (conditionsMet) msg.payload = createPayload(filteredEntities, "turn_on");
                // @ts-ignore
                msg.delay = IMMEDIATE_DELAY_MS; // Immediate action
            } else if (prevState === PresenceState.UNKNOWN && !inCoolDown) {
                // Recover from unknown to on, no cool-down active
                flowInfo.state = PresenceState.ON;
                if (!flowInfo.lastOn) {
                    flowInfo.lastOn = Date.now();
                }
                // @ts-ignore
                if (conditionsMet) msg.payload = createPayload(filteredEntities, "turn_on");
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
                if (conditionsMet) msg.payload = createPayload(filteredEntities, "turn_off");
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
                if (conditionsMet) msg.payload = createPayload(filteredEntities, "turn_off");
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

    // Update global context (accessible from API endpoints and publishers)
    // @ts-ignore
    global.set(flowInfoKey, flowInfo);
    // @ts-ignore
    global.set(presenceStatesKey, presenceStates);
    // @ts-ignore
    global.set(debounceKey, debounceInfo);

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
    msg.conditionsMet = conditionsMet;
    // @ts-ignore
    msg.debug = {
        topic: topic,
        sensorCount: Object.keys(presenceStates).length,
        coolDownSeconds: coolDown,
        conditionsMet: conditionsMet,
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
