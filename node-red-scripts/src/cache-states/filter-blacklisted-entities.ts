import { filterBlacklistedEntity } from "../utils/utils";

//@ts-ignore
const message: Hass.Message = msg;

const entities: Hass.State[] = Array.isArray(message.payload)
    ? message.payload
    : [message.payload];

const filteredEntities = entities.filter((e) => {
    return filterBlacklistedEntity(e);
});

// @ts-ignore
msg.payload = filteredEntities;
