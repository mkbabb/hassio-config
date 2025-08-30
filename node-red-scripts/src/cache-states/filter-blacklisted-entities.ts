import { filterBlacklistedEntity, getEntityDomain } from "../utils/utils";

//@ts-ignore
const message: Hass.Message = msg;

const entities: (Hass.State | string)[] = Array.isArray(message.payload)
    ? message.payload
    : [message.payload];

const domains: string[] = message?.domains ?? [];

const filteredEntities = entities
    .filter((e) => {
        return filterBlacklistedEntity(e);
    })
    .filter((e) => {
        return domains.length ? domains.includes(getEntityDomain(e)) : true;
    });

// @ts-ignore
msg.payload = filteredEntities;
