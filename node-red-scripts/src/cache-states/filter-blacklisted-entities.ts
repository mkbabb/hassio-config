import { createServiceCall, isBlacklisted } from "../utils/utils";

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
    "switch.plant_water_pump_switch"
];

//@ts-ignore
const message: Hass.Message = msg;

//@ts-ignore
const blacklist = msg.blacklist ?? blacklistedEntities;

const entities = <Hass.State[]>message.payload.filter((e) => {
    const { entity_id, state } = e;

    const whitelisted = !isBlacklisted(entity_id, blacklist);

    return whitelisted && state !== "unavailable";
});

// @ts-ignore
msg.payload = entities;
