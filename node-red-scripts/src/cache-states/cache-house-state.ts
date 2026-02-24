import { createServiceCall, createAwayPayload } from "./utils";
import { groupActions } from "../utils/service-calls";
import { shouldFilterEntity } from "../utils/static-states";

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

// Check if entity is presence-tracked (registered in "presence" namespace blacklist)
const isPresenceTracked = (entityId: string): boolean =>
    shouldFilterEntity(entityId, { checkBlacklist: true, checkStaticState: false, namespace: "presence" });

// Cached snapshot: EXCLUDE presence entities (won't be restored on home transition).
// Presence-tracked entities are controlled solely by the presence DFA — restoring them
// on home transition would create stale DFA state.
const cachedStates: Hass.Service[] = Object.values(entities)
    .filter(e => !isPresenceTracked(e.entity_id))
    .map(createServiceCall)
    .filter((x) => x !== undefined);

// Away payload: INCLUDE all entities (presence lights still turn off when leaving).
// This ensures lights don't stay on for 30min after departure.
const allServiceCalls: Hass.Service[] = Object.values(entities)
    .map(createServiceCall)
    .filter((x) => x !== undefined);
const awayPayload = createAwayPayload(allServiceCalls);

message.entities = entities;

message.cachedStates = cachedStates;

// the next node will execute this payload.
message.payload = groupActions(awayPayload);

//@ts-ignore
msg = message;
