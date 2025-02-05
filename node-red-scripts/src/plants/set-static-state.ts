// @ts-ignore
let staticPlantStates = flow.get("staticPlantStates");
// @ts-ignore
let staticBlacklist = flow.get("staticBlacklist");

if (staticPlantStates == null) {
    // @ts-ignore
    flow.set("staticPlantStates", {});
    // @ts-ignore
    staticPlantStates = flow.get("staticPlantStates");
}

if (staticBlacklist == null) {
    // @ts-ignore
    flow.set("staticBlacklist", []);
    // @ts-ignore
    staticBlacklist = flow.get("staticBlacklist");
}

// @ts-ignore
const payload = msg.payload;

staticPlantStates[payload.entity_id] = payload.state;

// @ts-ignore
msg.staticPlantStates = staticPlantStates;
