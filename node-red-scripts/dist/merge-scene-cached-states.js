"use strict";
function getEntityDomain(entityId) {
  const match = entityId.match(/^(.*)\..*$/);
  return match ? match[1] : entityId;
}
const setIfExists = (to, from, key) => {
  const value = from[key];
  if (value != null) {
    to[key] = value;
    return true;
  } else {
    return false;
  }
};
const lightAttributes = ["brightness"];
const fanAttributes = ["percentage"];
const climateAttributes = ["preset_mode"];
const domains = ["light", "switch", "fan", "climate", "lock", "cover", "media_player"];
const filterAttributes = function(domain, service, attributes) {
  let data = {};
  switch (domain) {
    case "light": {
      const colorMode = attributes["color_mode"];
      if (attributes[colorMode] != void 0) {
        data[colorMode] = attributes[colorMode];
      }
      lightAttributes.forEach((x) => setIfExists(data, attributes, x));
      break;
    }
    case "fan": {
      fanAttributes.forEach((x) => setIfExists(data, attributes, x));
      break;
    }
    case "climate": {
      climateAttributes.forEach((x) => setIfExists(data, attributes, x));
      break;
    }
  }
  return data;
};
const mapDomainToService = function(entity, domain) {
  switch (domain) {
    case "switch":
    case "light":
    case "fan": {
      return `turn_${entity.state}`;
    }
    case "media_player": {
      switch (entity.state) {
        case "standby":
        case "off":
          return "turn_off";
        case "on":
          return "turn_on";
        case "playing":
          return "media_play";
        case "paused":
          return "media_pause";
        default:
          return "turn_off";
      }
    }
    case "lock": {
      switch (entity.state) {
        case "locked":
          return "lock";
        case "unlocked":
          return "unlock";
      }
      break;
    }
    case "cover": {
      switch (entity.state) {
        case "open":
          return "open_cover";
        case "closed":
          return "close_cover";
      }
      break;
    }
    case "climate": {
      return "set_preset_mode";
    }
  }
  return void 0;
};
const createServiceCall = (entity) => {
  const domain = getEntityDomain(entity.entity_id);
  const service = mapDomainToService(entity, domain);
  if (!domains.includes(domain) || service === void 0) {
    return void 0;
  }
  return {
    domain,
    service,
    data: {
      entity_id: entity.entity_id,
      ...filterAttributes(domain, service, entity.attributes)
    }
  };
};
const createStatesMap = (states) => {
  return new Map(states.map((state) => [state.data.entity_id, state]));
};
const cachedStates = global.get("cachedStates") || [];
const cachedStatesMap = createStatesMap(cachedStates);
const sceneStates = Object.entries(msg.payload.entities).map(([entity_id, state]) => {
  return {
    entity_id,
    state: state.state,
    attributes: {
      ...state
    }
  };
}).map(createServiceCall).filter((x) => x !== void 0);
const newStatesMap = createStatesMap(sceneStates);
const mergedStatesMap = new Map([...cachedStatesMap, ...newStatesMap]);
const mergedStates = Array.from(mergedStatesMap.values());
global.set("cachedStates", mergedStates);
msg.payload = mergedStates;
return msg;
