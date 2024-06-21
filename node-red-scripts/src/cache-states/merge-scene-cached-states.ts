import { createServiceCall, createStatesMap } from "../utils/utils";

// @ts-ignore
const cachedStates: Partial<Hass.Service>[] = global.get("cachedStates") ?? [];
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
global.set("cachedStates", mergedStates);
// @ts-ignore
msg.payload = mergedStates;
