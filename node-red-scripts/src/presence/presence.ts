import { groupActions, filterBlacklistedEntity } from "../utils/utils";

const MAX_COOL_DOWN = 30 * 60; // 30 minutes

const DEFAULT_COOL_DOWN = 10 * 60; // 10 minutes

const NOW = Date.now();

// @ts-ignore
const message = msg;

// State of the presence, on or off
const payload = message.payload;

// Data from the input sensor
const data = message.data;

const dataEntityId = data.entity_id;

// Topic of the message
const topic: string = message.topic ?? dataEntityId;

// Cool down period for the presence in seconds
const coolDown = message.coolDown ?? DEFAULT_COOL_DOWN;

const entities: Hass.State[] = Array.isArray(message.entities)
    ? message.entities
    : [message.entities];

const filteredEntities = entities.filter((e) => {
    return filterBlacklistedEntity(e);
});

const cachedStatesKey = `cachedState.${topic}`;

const presenceStatesKey = `presenceStates.${topic}`;

const flowInfoKey = `flowInfo.${topic}`;

// @ts-ignore
let presenceStates: Record<string, boolean> = flow.get(presenceStatesKey);
if (presenceStates == null || typeof presenceStates !== "object") {
    // @ts-ignore
    flow.set(presenceStatesKey, {});
    // @ts-ignore
    presenceStates = flow.get(presenceStatesKey);
}

// @ts-ignore
let flowInfo = flow.get(flowInfoKey);
if (flowInfo == null || typeof flowInfo !== "object") {
    // @ts-ignore
    flow.set(flowInfoKey, {});
    // @ts-ignore
    flowInfo = flow.get(flowInfoKey);
}

const lastOn = flowInfo.lastOn ?? NOW;
const lastOff = flowInfo.lastOff ?? NOW;

// Update the presence state's data entity id with the current state:
presenceStates[dataEntityId] = payload === "on";

const presenceStatesValues = Object.values(presenceStates);
// If they're all off (all false), then the presence state is off (false); if any are on (true), then the presence state is on:
const presenceStateOn = presenceStatesValues.some(Boolean);

const state = presenceStateOn ? "on" : "off";
const prevState = flowInfo.state ?? "off";

if (!presenceStateOn) {
    // If the state is off:
    flowInfo.lastOff = NOW;
    flowInfo.state = state;

    const offPayload: Partial<Hass.Service & Hass.Action>[] = filteredEntities.map(
        (e) => {
            const entityId = e.entity_id;

            return {
                action: "homeassistant.turn_off",
                target: {
                    entity_id: entityId
                }
            };
        }
    );

    const actions = groupActions(offPayload);

    let delay = coolDown;

    const msDwelled = NOW - lastOn;
    const secondsDwelled = Math.floor(msDwelled / 1000);
    const minutesDwelled = Math.floor(secondsDwelled / 60);

    // For every minute dwelled, exponentially increase the cool down period,
    // up to a maximum:
    delay = Math.min(MAX_COOL_DOWN, delay + Math.pow(minutesDwelled, 2) * 60);
    delay = delay * 1000; // Convert to milliseconds

    // If the previous state was off, then the cool down period is 1:
    if (prevState === "off") {
        delay = 1;
        // Clear the cached state:
        // @ts-ignore
        flow.set(presenceStatesKey, {});
    }

    // @ts-ignore
    msg.delay = delay;
    // @ts-ignore
    msg.payload = actions;
} else if (presenceStateOn && prevState === "off") {
    // If the state is on and the previous state was off:
    flowInfo.lastOn = NOW;
    flowInfo.state = state;

    const onPayload: Partial<Hass.Service & Hass.Action>[] = filteredEntities.map(
        (e) => {
            const entityId = e.entity_id;

            return {
                action: "homeassistant.turn_on",
                target: {
                    entity_id: entityId
                }
            };
        }
    );

    const actions = groupActions(onPayload);

    // @ts-ignore
    msg.delay = 1;

    // @ts-ignore
    msg.payload = actions;
} else if (presenceStateOn && prevState === "on") {
    // If the state is on, and the previous state is on, then we don't need to do anything.
    // Just set the delay to 1, and the payload to null:

    // @ts-ignore
    msg.delay = 1;
    // @ts-ignore
    msg.payload = null;
}

// @ts-ignore
msg.presenceStates = presenceStates;
// @ts-ignore
msg.presenceState = state;

// @ts-ignore
