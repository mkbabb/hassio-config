import { filterBlacklistedEntity, getEntityDomain } from "../utils/utils";
import { shouldFilterEntity } from "../utils/static-states";

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
        // Also filter entities in any namespace blacklist (e.g., "presence" namespace)
        const entityId = typeof e === "string" ? e : e.entity_id;
        return !shouldFilterEntity(entityId, { checkBlacklist: true, checkStaticState: true });
    })
    .filter((e) => {
        return domains.length ? domains.includes(getEntityDomain(e)) : true;
    });

// @ts-ignore
msg.payload = filteredEntities;
