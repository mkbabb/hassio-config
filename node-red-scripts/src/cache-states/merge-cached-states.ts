import { createStatesMap, GLOBAL_CACHED_STATES_KEY } from "../utils/utils";

// @ts-ignore
const cachedStates: Partial<Hass.Service>[] =
    global.get(GLOBAL_CACHED_STATES_KEY) ?? [];
const cachedStatesMap = createStatesMap(cachedStates);

// @ts-ignore
const newStates: Partial<Hass.Service>[] = msg.payload;
const newStatesMap = createStatesMap(newStates);

const mergedStatesMap = new Map([...cachedStatesMap, ...newStatesMap]);
const mergedStates = Array.from(mergedStatesMap.values());

// @ts-ignore
global.set(GLOBAL_CACHED_STATES_KEY, mergedStates);
// @ts-ignore
msg.payload = mergedStates;
