// @ts-ignore
const newStates: Partial<Hass.Service>[] = msg.payload;

// @ts-ignore
const cachedStates: Partial<Hass.Service>[] = (global.get("cachedStates") || []).filter(
    (cachedState) => {
        return !newStates.find((newState) => {
            return cachedState.entity_id === newState.entity_id;
        });
    }
);
// push the newStates to the cachedStates
const mergedStates = [...newStates, ...cachedStates];
// @ts-ignore
global.set("cachedStates", mergedStates);
// @ts-ignore
msg.payload = mergedStates;
