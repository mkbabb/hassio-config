import { groupActions } from "../utils/utils";

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
const coolDown = message.coolDown ?? 30;

const entities: Hass.State[] = Array.isArray(message.entities)
    ? message.entities
    : [message.entities];

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

// If the state is off:
if (!presenceStateOn) {
    flowInfo.lastOff = NOW;
    flowInfo.state = state;

    // Clear the presence states:
    // @ts-ignore
    // flow.set(presenceStatesKey, {});

    const offPayload: Partial<Hass.Service & Hass.Action>[] = entities.map((e) => {
        const entityId = e.entity_id;

        return {
            action: "homeassistant.turn_off",
            target: {
                entity_id: entityId
            }
        };
    });

    const actions = groupActions(offPayload);

    let delay = coolDown;
    // // Override the cool down period with the one from the flow info:
    // if (flowInfo.coolDown != null) {
    //     delay = flowInfo.coolDown;
    // }

    const msDwelled = NOW - lastOn;
    const secondsDwelled = Math.floor(msDwelled / 1000);
    const minutesDwelled = Math.floor(secondsDwelled / 60);

    // For every minute dwelled, exponentially increase the cool down period,
    // up to a maximum of 10 minutes:
    delay = Math.min(10 * 60, delay + Math.pow(minutesDwelled, 2) * 60);

    // @ts-ignore
    msg.delay = delay * 1000; // Convert to milliseconds

    // @ts-ignore
    msg.payload = actions;
} else {
    flowInfo.lastOn = NOW;
    flowInfo.state = state;

    const onPayload: Partial<Hass.Service & Hass.Action>[] = entities.map((e) => {
        const entityId = e.entity_id;

        return {
            action: "homeassistant.turn_on",
            target: {
                entity_id: entityId
            }
        };
    });

    const actions = groupActions(onPayload);

    // @ts-ignore
    msg.delay = 0;

    // @ts-ignore
    msg.payload = actions;
}

// @ts-ignore
msg.presenceStates = presenceStates;
// @ts-ignore
msg.presenceState = state;
