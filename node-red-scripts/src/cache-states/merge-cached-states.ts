import { createStatesMap } from "../utils/utils";

// @ts-ignore
const cachedStates: Partial<Hass.Service>[] = global.get("cachedStates") ?? [];
const cachedStatesMap = createStatesMap(cachedStates);

// @ts-ignore
const newStates: Partial<Hass.Service>[] = msg.payload;
const newStatesMap = createStatesMap(newStates);

const mergedStatesMap = new Map([...cachedStatesMap, ...newStatesMap]);
const mergedStates = Array.from(mergedStatesMap.values());

// @ts-ignore
global.set("cachedStates", mergedStates);
// @ts-ignore
msg.payload = mergedStates;
