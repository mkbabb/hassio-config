import { createServiceCall, isBlacklisted, getEntityDomain } from "../utils/utils";

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
    "dryer_power",
    // water pump
    "switch.plant_water_pump_switch",
    // ESPresnce:
    /espresense_.*/i
];

//@ts-ignore
const message: Hass.Message = msg;

const payload = Array.isArray(message.payload) ? message.payload : [message.payload];

//@ts-ignore
const blacklist = msg.blacklist ?? blacklistedEntities;
//@ts-ignore
const domains = msg.domains ?? undefined;

const filterEntity = (e: Hass.State | string) => {
    // check if the object is an entity, or just an entity_id
    let entity_id: string;
    let state: string;

    if (typeof e === "string") {
        entity_id = e;
        state = undefined;
    } else {
        entity_id = e.entity_id;
        state = e.state;
    }

    const whitelisted = !isBlacklisted(entity_id, blacklist);

    const inDomain = domains ? domains.includes(getEntityDomain(entity_id)) : true;

    const isUnavailable = state === "unavailable" || state === "unknown";

    return whitelisted && inDomain && !isUnavailable;
};

const entities = payload.filter(filterEntity);

// @ts-ignore
msg.payload = entities;
