"use strict";
let staticPlantStates = flow.get("staticPlantStates");
if (staticPlantStates == null) {
  flow.set("staticPlantStates", {});
  staticPlantStates = flow.get("staticPlantStates");
}
const payload = msg.payload;
if (staticPlantStates[payload.entity_id] != null) {
  delete staticPlantStates[payload.entity_id];
} else {
  staticPlantStates[payload.entity_id] = payload.state;
}
msg.staticPlantStates = staticPlantStates;
return msg;
