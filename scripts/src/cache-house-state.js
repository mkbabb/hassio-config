//@ts-expect-error
const message = msg;
const entities = message.payload;
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
        case "climate": {
            return "set_temperature";
        }
        case "lock": {
            switch (entity.state) {
                case "locked":
                    return "lock";
                case "unlocked":
                    return "unlock";
            }
        }
        case "lock": {
            switch (entity.state) {
                case "closed":
                    return "close";
                case "unlocked":
                    return "unlock";
            }
        }
        default: {
            return "turn_off";
        }
    }
};
// create the cached state object that will be saved to the global flow.
const cachedStates = entities.map((e) => {
    const domain = e.entity_id.split(".")[0];
    const service = mapDomainToService(e, domain);
    const state = {
        domain: domain,
        service: service,
        data: {
            entity_id: e.entity_id
        }
    };
    return state;
});
/* creates a set of away states that we'll entry once our away condition is met within hass.
 * For example, we turn off all of the cached lights and switches, and turn on all the fans to low.
 */
const awayPayload = cachedStates.map((state) => {
    const { domain } = state;
    const { entity_id } = state.data;
    const payload = { domain, data: { entity_id } };
    switch (domain) {
        case "switch":
        case "light": {
            payload["service"] = "turn_off";
            break;
        }
        case "fan": {
            payload["service"] = "turn_on";
            payload.data["speed"] = "low";
            break;
        }
        case "climate": {
            payload["service"] = "set_preset_mode";
            payload.data["preset_mode"] = "away";
            break;
        }
        case "lock": {
            payload["service"] = "lock";
            break;
        }
        default: {
            break;
        }
    }
    return payload;
});
//@ts-ignore
// cache the states!
flow.set("cachedStates", cachedStates);
// the next node will execute this payload.
message.payload = awayPayload;
//@ts-ignore
return message;
