// @ts-ignore
const payload = msg.payload;

// @ts-ignore
const staticPlantStates = flow.get("staticPlantStates") ?? {};

if (staticPlantStates[payload.entity_id] != null) {
    // @ts-ignore
    msg.payload.entity_id = null;
}
