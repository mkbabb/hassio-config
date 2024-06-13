"use strict";
const payload = msg.payload;
const staticPlantStates = flow.get("staticPlantStates") ?? {};
if (staticPlantStates[payload.entity_id] != null) {
  msg.payload.entity_id = null;
}
return msg;
