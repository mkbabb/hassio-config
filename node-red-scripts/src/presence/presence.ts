import { groupActions, filterBlacklistedEntity } from "../utils/utils";

const MAX_COOL_DOWN = 30 * 60; // 30 minutes

const DEFAULT_COOL_DOWN = 10 * 60; // 10 minutes

const createOnPayload = (entities: Hass.State[]) => {
    const actions: Partial<Hass.Service & Hass.Action>[] = entities.map((e) => {
        const entityId = e.entity_id;

        return {
            action: "homeassistant.turn_on",
            target: {
                entity_id: entityId
            }
        };
    });

    return groupActions(actions);
};

const createOffPayload = (entities: Hass.State[]) => {
    const actions: Partial<Hass.Service & Hass.Action>[] = entities.map((e) => {
        const entityId = e.entity_id;

        return {
            action: "homeassistant.turn_off",
            target: {
                entity_id: entityId
            }
        };
    });

    return groupActions(actions);
};

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

const presenceStatesKey = `presenceStates.${topic}`;

const flowInfoKey = `flowInfo.${topic}`;

// @ts-ignore
let presenceStates: Record<string, string> = flow.get(presenceStatesKey);
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

// Helper function to check if there are pending timers
const hasPendingTimer = () => {
    if (!flowInfo.delay || !flowInfo.lastOff) {
        return false;
    }

    const timeSinceLastOff = Date.now() - flowInfo.lastOff;

    return timeSinceLastOff < flowInfo.delay;
};

const lastOn = flowInfo.lastOn ?? Date.now();

// Update the presence state's data entity id with the current state:
presenceStates[dataEntityId] = payload;

const presenceStatesValues = Object.values(presenceStates);

const presenceStateOn = presenceStatesValues.some((state) => {
    return state === "on";
});

const presenceStateOff = presenceStatesValues.every((state) => {
    return state === "off";
});

const presenceStateUnknown = presenceStatesValues.some((state) => {
    return state === "unknown";
});

const prevState = flowInfo.state ?? "off";

if (presenceStateUnknown) {
    // If the state is unknown:
    flowInfo.state = "unknown";

    // @ts-ignore
    msg.delay = 1;

    // @ts-ignore
    msg.payload = null;
} else if (presenceStateOff && prevState === "on") {
    // If the state is off and the previous state was on:
    flowInfo.lastOff = Date.now();
    flowInfo.lastOn = null;
    flowInfo.state = "off";

    let delay = coolDown;

    const msDwelled = Date.now() - lastOn;
    const secondsDwelled = Math.floor(msDwelled / 1000);
    const minutesDwelled = Math.floor(secondsDwelled / 60);

    // For every minute dwelled, exponentially increase the cool down period,
    // up to a maximum:
    delay = Math.min(MAX_COOL_DOWN, delay + Math.pow(minutesDwelled, 2) * 60);
    delay = delay * 1000; // Convert to milliseconds

    // @ts-ignore
    msg.delay = delay;
    // Update the flow info with the delay
    flowInfo.delay = delay;

    // @ts-ignore
    msg.payload = createOffPayload(filteredEntities);
} else if (presenceStateOff && prevState === "off") {
    // If the state is off and the previous state was off:
    // @ts-ignore
    msg.delay = 1;

    // @ts-ignore
    msg.payload = null;
} else if (presenceStateOff && prevState === "unknown") {
    // If the state is off and the previous state was unknown:

    // Only issue off payload if there are NO pending timers active
    if (!hasPendingTimer()) {
        flowInfo.lastOff = Date.now();
        flowInfo.state = "off";

        // @ts-ignore
        msg.delay = 1;
        // Update the flow info with the delay
        flowInfo.delay = 1;

        // @ts-ignore
        msg.payload = createOffPayload(filteredEntities);
    } else {
        // There's a pending timer, so don't issue off payload
        // @ts-ignore
        msg.delay = 1;

        // @ts-ignore
        msg.payload = null;
    }
} else if (presenceStateOn && prevState === "off") {
    // If the state is on and the previous state was off:
    flowInfo.lastOn = Date.now();
    flowInfo.lastOff = null;
    flowInfo.state = "on";

    // @ts-ignore
    msg.delay = 1;

    // @ts-ignore
    msg.payload = createOnPayload(filteredEntities);
} else if (presenceStateOn && prevState === "on") {
    // If the state is on and the previous state was on:
    flowInfo.lastOn = Date.now();
    flowInfo.lastOff = null;
    flowInfo.state = "on";

    // @ts-ignore
    msg.delay = 1;

    // @ts-ignore
    msg.payload = null;
} else {
    // @ts-ignore
    msg.delay = 1;

    // @ts-ignore
    msg.payload = null;
}

// @ts-ignore
msg.presenceStates = presenceStates;
// @ts-ignore
msg.presenceState = flowInfo.state;
// @ts-ignore
msg.flowInfo = flowInfo;
