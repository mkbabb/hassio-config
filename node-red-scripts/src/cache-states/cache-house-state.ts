import {
    createServiceCall,
    isBlacklisted,
    serviceToActionCall,
    groupActions
} from "../utils/utils";

//@ts-ignore
const message: Hass.Message = msg;
const entities = <Hass.State[]>message.payload.filter((e) => {
    const { entity_id, state } = e;
    return state !== "unavailable";
});

// create the cached state object that will be saved to the global flow.
const currentStates = entities.map(createServiceCall).filter((x) => x !== undefined);

const cachedStates = groupActions(currentStates.map(serviceToActionCall));

// Creates a set of away states that we'll entry once our away condition is met within hass.
// For example, we turn off all of the cached lights and switches, and turn on all the fans to low.
const awayPayload: Partial<Hass.Service & Hass.Action>[] = currentStates
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
                break;
            }
            case "fan": {
                payload["service"] = "turn_on";
                payload.data["percentage"] = 100 / 3;
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
            case "cover": {
                payload["service"] = "close_cover";
                break;
            }
            case "media_player": {
                payload["service"] = "turn_off";
                break;
            }
        }

        // Support the new "action" field, which is the union of "service" and "domain"
        // @ts-ignore
        payload["action"] = `${payload.domain}.${payload.service}`; // e.g. "light.turn_off"

        // New "target" field, which supports various ids:
        payload["target"] = {
            entity_id: entity_id
        };

        return payload;
    })
    .flat();

message.entities = message.payload;
message.cachedStates = cachedStates;
// the next node will execute this payload.
message.payload = groupActions(awayPayload);

//@ts-ignore
msg = message;
