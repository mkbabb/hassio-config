import { createStatesMap } from "./utils";
import { GLOBAL_CACHED_STATES_KEY } from "../utils/utils";
import { shouldFilterEntity } from "../utils/static-states";

// @ts-ignore
const cachedStates: Partial<Hass.Service>[] =
    global.get(GLOBAL_CACHED_STATES_KEY) ?? [];
const cachedStatesMap = createStatesMap(cachedStates);

// @ts-ignore
const newStates: Partial<Hass.Service>[] = msg.payload;

// Filter presence-tracked entities from new states before merging
const filteredNewStates = newStates.filter(s => {
    const entityId = s.data?.entity_id;
    return !entityId || !shouldFilterEntity(entityId, { checkBlacklist: true, checkStaticState: false, namespace: "presence" });
});
const newStatesMap = createStatesMap(filteredNewStates);

const mergedStatesMap = new Map([...cachedStatesMap, ...newStatesMap]);
const mergedStates = Array.from(mergedStatesMap.values());

// @ts-ignore
global.set(GLOBAL_CACHED_STATES_KEY, mergedStates);
// @ts-ignore
msg.payload = mergedStates;
