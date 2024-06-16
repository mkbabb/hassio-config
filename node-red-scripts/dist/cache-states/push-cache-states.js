"use strict";
const newStates = msg.payload;
const cachedStates = (global.get("cachedStates") || []).filter(
  (cachedState) => {
    return !newStates.find((newState) => {
      return cachedState.entity_id === newState.entity_id;
    });
  }
);
const mergedStates = [...newStates, ...cachedStates];
global.set("cachedStates", mergedStates);
msg.payload = mergedStates;
return msg;
