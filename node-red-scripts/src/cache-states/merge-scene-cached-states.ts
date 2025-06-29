import { createServiceCall, createStatesMap, GLOBAL_CACHED_STATES_KEY } from "../utils/utils";

// @ts-ignore
const cachedStates: Partial<Hass.Service>[] = global.get(GLOBAL_CACHED_STATES_KEY) ?? [];
const cachedStatesMap = createStatesMap(cachedStates);

// @ts-ignore
const sceneStates: Partial<Hass.Service>[] = Object.entries(msg.payload.entities)
    .map(([entity_id, state]: [string, any]) => {
        return {
            entity_id: entity_id,
            state: state.state,
            attributes: {
                ...state
            }
        };
    })
    .map(createServiceCall)
    .filter((x) => x !== undefined);

const newStatesMap = createStatesMap(sceneStates);

const mergedStatesMap = new Map([...cachedStatesMap, ...newStatesMap]);
const mergedStates = Array.from(mergedStatesMap.values());

// @ts-ignore
global.set(GLOBAL_CACHED_STATES_KEY, mergedStates);
// @ts-ignore
msg.payload = mergedStates;
