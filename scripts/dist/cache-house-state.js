// Ignore the car, and all grow lights.
const blacklistedEntities = [
    "son_of_toast",
    /.*grow.*/i,
    "washer_power",
    "dryer_power"
];
const setIfExists = (to, from, key) => {
    const value = from[key];
    if (value != null) {
        to[key] = value;
        return true;
    }
    else {
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
        }
        else {
            return blacklistItem.test(entity_id);
        }
    });
};
//@ts-expect-error
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
/**
 * Filters a list of attributes based on valid state attributes of a given entity.
 * These are the states that we'll save when caching.
 *
 * @param domain entity domain.
 * @param service entity service.
 * @param attributes entity attributes to cache.
 */
const filterAttributes = function (domain, service, attributes) {
    let data = {};
    switch (domain) {
        case "light": {
            const colorMode = attributes["color_mode"];
            if (attributes[colorMode] != undefined) {
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
/**
 * Maps an input entity's domain to an appropriate service for
 * later caching.
 *
 * light -> turn_[on, off], for example.
 *
 * @param entity input hass entity.
 * @param domain domain thereof.
 */
const mapDomainToService = function (entity, domain) {
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
    return undefined;
};
// create the cached state object that will be saved to the global flow.
const cachedStates = entities
    .map((e) => {
    const domain = e.entity_id.split(".")[0];
    const service = mapDomainToService(e, domain);
    if (!domains.includes(domain) || service === undefined) {
        return undefined;
    }
    const serviceCall = {
        domain: domain,
        service: service,
        data: Object.assign({ entity_id: e.entity_id, state: e.state }, filterAttributes(domain, service, e.attributes))
    };
    return serviceCall;
})
    .filter((x) => x !== undefined);
// We only cache the states we need to - currently active entities, or states.
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
// Creates a set of away states that we'll entry once our away condition is met within hass.
// For example, we turn off all of the cached lights and switches, and turn on all the fans to low.
const awayPayload = activeStates
    .map((serviceCall) => {
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
})
    .flat(); // we may need to support multiple payload returns per state.
//@ts-ignore
flow.set("cachedStates", cachedStates);
message.cachedStates = cachedStates;
message.entities = message.payload;
// the next node will execute this payload.
message.payload = awayPayload;
//@ts-ignore
return message;
