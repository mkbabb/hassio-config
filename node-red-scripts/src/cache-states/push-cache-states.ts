// @ts-ignore
const newStates: Partial<Hass.Service>[] = msg.payload;

// @ts-ignore
const cachedStates: Partial<Hass.Service>[] = global.get("cachedStates") ?? [];

// filter out the newStates that are already in the cachedStates
const filteredStates: Partial<Hass.Service>[] = cachedStates.filter((cachedState) => {
    return !newStates.find((newState) => {
        return cachedState.data.entity_id === newState.entity_id;
    });
});

// push the newStates to the cachedStates
const mergedStates = [...newStates, ...filteredStates];
// @ts-ignore
global.set("cachedStates", mergedStates);
// @ts-ignore
msg.payload = mergedStates;
