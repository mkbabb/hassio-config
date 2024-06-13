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
const normalizeIncludes = (s1, s2) => {
  return s1.toLowerCase().includes(s2.toLowerCase());
};
const isBlacklisted = (entity_id, blacklisted) => {
  return blacklisted.some((blacklistItem) => {
    if (typeof blacklistItem === "string") {
      return normalizeIncludes(entity_id, blacklistItem);
    } else {
      return blacklistItem.test(entity_id);
    }
  });
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
      state: entity.state,
      ...filterAttributes(domain, service, entity.attributes)
    }
  };
};
const blacklistedEntities = [
  // car
  "son_of_toast",
  // grow lights
  /.*grow.*/i,
  // blinds
  /.*blinds.*/i,
  // air purifiers
  /.*air_purifier.*/i,
  // garage door
  /switch.ratgdov25i_4b1c3b.*/i,
  "lock.ratgdov25i_4b1c3b_lock_remotes",
  // sonos
  /.*sonos_beam.*/i,
  // washer/dryer
  "washer_power",
  "dryer_power",
  // water pump
  "switch.plant_water_pump_switch"
];
const message = msg;
const entities = message.payload.filter((e) => {
  const { entity_id, state } = e;
  const whitelisted = !isBlacklisted(entity_id, blacklistedEntities);
  return whitelisted && state !== "unavailable";
});
const cachedStates = entities.map(createServiceCall).filter((x) => x !== void 0);
cachedStates.forEach((x) => {
  delete x.data.state;
});
const awayPayload = cachedStates.map((serviceCall) => {
  const {
    domain,
    data: { entity_id }
  } = serviceCall;
  const payload = { domain, data: { entity_id } };
  switch (domain) {
    case "switch":
    case "light": {
      payload["service"] = "turn_off";
      return payload;
    }
    case "fan": {
      payload["service"] = "turn_on";
      payload.data["percentage"] = 100 / 3;
      return payload;
    }
    case "climate": {
      payload["service"] = "set_preset_mode";
      payload.data["preset_mode"] = "away";
      return payload;
    }
    case "lock": {
      payload["service"] = "lock";
      return payload;
    }
    case "cover": {
      payload["service"] = "close_cover";
      return payload;
    }
    case "media_player": {
      payload["service"] = "turn_off";
      return payload;
    }
  }
}).flat();
flow.set("cachedStates", cachedStates);
message.cachedStates = cachedStates;
message.entities = message.payload;
message.payload = awayPayload;
msg = message;
return msg;
