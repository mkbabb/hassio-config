import { createServiceCall, isBlacklisted } from "../utils/utils";

//@ts-ignore
const message: Hass.Message = msg;
const entities = <Hass.State[]>message.payload.filter((e) => {
    const { entity_id, state } = e;
    return state !== "unavailable";
});

// create the cached state object that will be saved to the global flow.
const cachedStates: Partial<Hass.Service>[] = entities
    .map(createServiceCall)
    .filter((x) => x !== undefined);

// Creates a set of away states that we'll entry once our away condition is met within hass.
// For example, we turn off all of the cached lights and switches, and turn on all the fans to low.
const awayPayload: Partial<Hass.Service>[] = cachedStates
    .map((serviceCall) => {
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
    })
    .flat();

message.entities = message.payload;
message.cachedStates = cachedStates;
// the next node will execute this payload.
message.payload = awayPayload;

//@ts-ignore
msg = message;
