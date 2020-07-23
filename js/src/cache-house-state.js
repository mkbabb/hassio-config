//@ts-expect-error
const message = msg;
const entities = message.payload;
const switchServices = [];
const lightServices = [
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
const fanServices = ["speed"];
const domainServices = {
    switch: {
        turn_on: switchServices,
        turn_off: switchServices
    },
    light: {
        turn_on: lightServices,
        turn_off: lightServices
    },
    fan: {
        turn_on: fanServices,
        turn_off: fanServices
    },
    climate: {
        set_temperature: ["temperature", "hvac_mode"],
        set_preset_mode: ["preset_mode"]
    }
};
const filterAttributes = function (domain, service, attributes) {
    let data = {};
    const allowedAttributes = domainServices[domain][service];
    Object.keys(attributes).forEach((key) => {
        if (allowedAttributes.indexOf(key) !== -1) {
            data[key] = attributes[key];
        }
    });
    return data;
};
const cachedStates = entities.map((e) => {
    const domain = e.entity_id.split(".")[0];
    const service = domain === "switch" || domain === "light" || domain === "fan"
        ? `turn_${e.state}`
        : domain === "climate"
            ? "set_temperature"
            : null;
    const state = {
        domain: domain,
        service: service,
        data: Object.assign({ entity_id: e.entity_id }, filterAttributes(domain, service, e.attributes))
    };
    return state;
});
const awayPayload = cachedStates.map((state) => {
    const { domain } = state;
    const { entity_id } = state.data;
    const payload = { domain, data: { entity_id } };
    if (domain === "switch" || domain === "light") {
        payload["service"] = "turn_off";
    }
    else if (domain === "fan") {
        payload["service"] = "turn_on";
        payload.data["speed"] = "high";
    }
    else if (domain === "climate") {
        payload["service"] = "set_preset_mode";
        payload.data["preset_mode"] = "away";
    }
    return payload;
});
//@ts-ignore
flow.set("cachedStates", cachedStates);
message.payload = awayPayload;
//@ts-ignore
return message;
