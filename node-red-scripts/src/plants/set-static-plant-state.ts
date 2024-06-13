// @ts-ignore
let staticPlantStates = flow.get("staticPlantStates");

if (staticPlantStates == null) {
    // @ts-ignore
    flow.set("staticPlantStates", {});
    // @ts-ignore
    staticPlantStates = flow.get("staticPlantStates");
}

// @ts-ignore
const payload = msg.payload;

if (staticPlantStates[payload.entity_id] != null) {
    delete staticPlantStates[payload.entity_id];
} else {
    staticPlantStates[payload.entity_id] = payload.state;
}

// @ts-ignore
msg.staticPlantStates = staticPlantStates;
