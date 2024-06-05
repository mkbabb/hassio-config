"use strict";
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
  "dryer_power"
];
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
const message = msg;
const entities = message.payload.filter((e) => {
  const { entity_id, state } = e;
  const whitelisted = !isBlacklisted(entity_id, blacklistedEntities);
  return whitelisted && state !== "unavailable";
});
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
const cachedStates = entities.map((e) => {
  const domain = e.entity_id.split(".")[0];
  const service = mapDomainToService(e, domain);
  if (!domains.includes(domain) || service === void 0) {
    return void 0;
  }
  const serviceCall = {
    domain,
    service,
    data: {
      entity_id: e.entity_id,
      state: e.state,
      ...filterAttributes(domain, service, e.attributes)
    }
  };
  return serviceCall;
}).filter((x) => x !== void 0);
const activeStates = cachedStates.filter((serviceCall) => {
  const { domain } = serviceCall;
  const { state } = serviceCall.data;
  switch (domain) {
    case "switch":
    case "light": {
      return state === "on";
    }
    case "lock": {
      return state === "unlocked";
    }
    case "cover": {
      return state === "open";
    }
    case "climate": {
      return state !== "off";
    }
    case "fan": {
      return state !== "off";
    }
    case "media_player": {
      return state !== "off" || state !== "standby";
    }
  }
  return true;
});
cachedStates.forEach((x) => {
  delete x.data.state;
});
const awayPayload = activeStates.map((serviceCall) => {
  const { domain } = serviceCall;
  const { entity_id } = serviceCall.data;
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
