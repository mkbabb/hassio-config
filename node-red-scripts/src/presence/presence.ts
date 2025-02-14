import { groupActions } from "../utils/utils";

// @ts-ignore
const message = msg;

// State of the presence, on or off
const payload = message.payload;

// Data from the input sensor
const data = message.data;

const dataEntityId = data.entity_id;

// Topic of the message
const topic: string = message.topic ?? dataEntityId;

const entities: string[] = Array.isArray(message.entities)
    ? message.entities
    : [message.entities];

const cachedStatesKey = `cachedState.${topic}`;

const presenceStatesKey = `presenceStates.${topic}`;

// @ts-ignore
let presenceStates: Record<string, boolean> = flow.get(presenceStatesKey);

if (presenceStates == null || typeof presenceStates !== "object") {
    // @ts-ignore
    flow.set(presenceStatesKey, {});
    // @ts-ignore
    presenceStates = flow.get(presenceStatesKey);
}

// Update the presence state's data entity id with the current state:
presenceStates[dataEntityId] = payload === "on";

const presenceStatesValues = Object.values(presenceStates);
// If they're all off (all false), then the presence state is off (false); if any are on (true), then the presence state is on:
const presenceStateOn = presenceStatesValues.some(Boolean);

// If the state is off, cache the states of the entities:
if (!presenceStateOn) {
    const offPayload: Partial<Hass.Service & Hass.Action>[] = entities.map(
        (entityId) => {
            return {
                action: "homeassistant.turn_off",
                target: {
                    entity_id: entityId
                }
            };
        }
    );

    const actions = groupActions(offPayload);

    // @ts-ignore
    msg.payload = actions;
} else {
    const onPayload: Partial<Hass.Service & Hass.Action>[] = entities.map(
        (entityId) => {
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
    msg.payload = actions;
}

// @ts-ignore
msg.presenceStates = presenceStates;
// @ts-ignore
msg.presenceState = presenceStateOn;
