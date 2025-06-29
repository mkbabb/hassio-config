import { createServiceCall, groupActions, createAwayPayload } from "../utils/utils";

//@ts-ignore
const message: Hass.Message = msg;
const entities: {
    [key: string]: Hass.State;
} = message.payload
    .filter((e) => {
        const { entity_id, state } = e;
        return state !== "unavailable";
    })
    .reduce((acc, e) => {
        acc[e.entity_id] = e;
        return acc;
    }, {});

// create the cached state object that will be saved to the global flow.
const cachedStates: Hass.Service[] = Object.values(entities)
    .map(createServiceCall)
    .filter((x) => x !== undefined);

// Creates a set of away states that we'll entry once our away condition is met within hass.
// For example, we turn off all of the cached lights and switches, and turn on all the fans to low.
const awayPayload = createAwayPayload(cachedStates);

message.entities = entities;

message.cachedStates = cachedStates;

// the next node will execute this payload.
message.payload = groupActions(awayPayload);

//@ts-ignore
msg = message;
