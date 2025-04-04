// @ts-ignore
const newStates: Partial<Hass.Service>[] = msg.payload;

// @ts-ignore
const cachedStates: Partial<Hass.Service | Hass.Action>[] =
    global.get("cachedStates") ?? [];

// filter out the newStates that are already in the cachedStates
const filteredStates: Partial<Hass.Action>[] = cachedStates.filter((cachedState) => {
    // @ts-ignore
    const cachedId = cachedState?.target?.entity_id ?? cachedState.data?.entity_id;
    const cachedIds = Array.isArray(cachedId) ? cachedId : [cachedId];

    return !newStates.find((newState) => {
        return cachedIds.includes(newState.entity_id);
    });
});

// push the newStates to the cachedStates
const mergedStates = [...newStates, ...filteredStates];

global.set("cachedStates", mergedStates);
// @ts-ignore
msg.payload = mergedStates;
