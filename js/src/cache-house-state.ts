//@ts-expect-error
const message: Hass.Message = msg;
const entities = <Hass.State[]>message.payload;

interface DomainServices {
    [s: string]: {
        [s: string]: string[];
    };
}

const switchParams = [];
const lightParams = [
    "transition",
    "rgb_color",
    "color_name",
    "hs_color",
    "xy_color",
    "color_temp",
    "kelvin",
    "white_value",
    "brightness",
    "brightness_step",
    "brightness_step_pct",
    "profile",
    "flash",
    "effect"
];
const fanParams = ["speed"];

const domainServiceParams: DomainServices = {
    switch: {
        turn_on: switchParams,
        turn_off: switchParams
    },
    light: {
        turn_on: lightParams,
        turn_off: lightParams
    },
    fan: {
        turn_on: fanParams,
        turn_off: fanParams
    },
    climate: {
        set_temperature: ["temperature", "hvac_mode"],
        set_preset_mode: ["preset_mode"]
    },
    media_player: {
        turn_on: [],
        turn_off: [],
        media_play: [],
        media_pause: []
    }
};

const filterAttributes = function (
    domain: string,
    service: string,
    attributes: Hass.Attribute
) {
    let data = {};
    const allowedAttributes = domainServiceParams?.domain?.service ?? [];

    Object.keys(attributes).forEach((key) => {
        if (allowedAttributes.indexOf(key) !== -1) {
            data[key] = attributes[key];
        }
    });

    return data;
};

const mapDomainToService = function (entity: Hass.State, domain: string) {
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
        default: {
            return "turn_off";
        }
    }
};

const cachedStates: Partial<Hass.Service>[] = entities.map((e) => {
    const domain = e.entity_id.split(".")[0];
    const service = mapDomainToService(e, domain);

    const state: Partial<Hass.Service> = {
        domain: domain,
        service: service,
        data: {
            entity_id: e.entity_id,
            ...filterAttributes(domain, service, e.attributes)
        }
    };

    return state;
});

const awayPayload: Partial<Hass.Service>[] = cachedStates.map((state) => {
    const { domain } = state;
    const { entity_id } = state.data;

    const payload = { domain, data: { entity_id } };

    switch (domain) {
        case "switch":
        case "light":
        case "media_player": {
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
        default: {
            break;
        }
    }

    return payload;
});

//@ts-ignore
flow.set("cachedStates", cachedStates);
message.payload = awayPayload;
//@ts-ignore
return message;
export {};
