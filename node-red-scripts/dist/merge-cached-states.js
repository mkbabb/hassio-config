"use strict";
const createStatesMap = (states) => {
  return new Map(states.map((state) => [state.data.entity_id, state]));
};
const cachedStates = global.get("cachedStates") || [];
const cachedStatesMap = createStatesMap(cachedStates);
const newStates = msg.payload;
const newStatesMap = createStatesMap(newStates);
const mergedStatesMap = new Map([...cachedStatesMap, ...newStatesMap]);
const mergedStates = Array.from(mergedStatesMap.values());
global.set("cachedStates", mergedStates);
msg.payload = mergedStates;
return msg;
