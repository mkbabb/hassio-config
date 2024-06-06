import { createServiceCall, getEntityDomain, isBlacklisted } from "./utils";

// Ignore the car, and all grow lights.
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

//@ts-ignore
const message: Hass.Message = msg;
const entities = <Hass.State[]>message.payload.filter((e) => {
    const { entity_id, state } = e;

    const whitelisted = !isBlacklisted(entity_id, blacklistedEntities);

    return whitelisted && state !== "unavailable";
});

// create the cached state object that will be saved to the global flow.
const cachedStates: Partial<Hass.Service>[] = entities
    .map(createServiceCall)
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
const awayPayload: Partial<Hass.Service>[] = activeStates
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
    .flat();

//@ts-ignore
flow.set("cachedStates", cachedStates);

message.cachedStates = cachedStates;
message.entities = message.payload;

// the next node will execute this payload.
message.payload = awayPayload;

//@ts-ignore
msg = message;
