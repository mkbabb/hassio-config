export function getEntityBasename(entityId: string): string {
    const match = entityId.match(/^.*\.(.*)$/);

    return match ? match[1] : entityId;
}

export function getEntityDomain(entityId: string): string {
    const match = entityId.match(/^(.*)\..*$/);

    return match ? match[1] : entityId;
}

export function getTimeComponents(time: string): [number, number, number] {
    let timeParts = time.split(":");

    let [hours, mins, seconds] = timeParts
        .concat(Array(3 - timeParts.length).fill("00"))
        .map((x) => parseInt(x));

    return [hours, mins, seconds];
}

export function normalizeTime(time: string): string {
    let [hours, mins, seconds] = getTimeComponents(time);
    return `${hours}:${mins}:${seconds}`;
}

export function dateToTimeString(date: Date): string {
    return date.toTimeString().split(" ")[0];
}

export function timeStringToDate(time: string): Date {
    time = normalizeTime(time);
    let [hours, mins, seconds] = getTimeComponents(time);

    let date = new Date();
    date.setHours(hours);
    date.setMinutes(mins);
    date.setSeconds(seconds);

    return date;
}

export function extractTimeFromPayload(
    entityId: string,
    payload: Hass.State[]
): string {
    const entity = payload.find((item) => item.entity_id === entityId);
    return entity ? normalizeTime(entity.state) : "00:00:00";
}

export function getTimeString(): string {
    const timeObject = new Date(Date.now());
    const options: Intl.DateTimeFormatOptions = {
        year: "numeric",
        month: "long",
        day: "numeric",
        weekday: "long",
        hour: "numeric",
        minute: "numeric",
        second: "numeric",
        hour12: false,
        timeZone: "America/New_York"
    };

    const locale = "en-US";

    return timeObject.toLocaleString(locale, options);
}

export const setIfExists = (
    to: object,
    from: object,
    key: string | number | symbol
) => {
    const value = from[key];

    if (value != null) {
        to[key] = value;
        return true;
    } else {
        return false;
    }
};

export const normalizeIncludes = (s1: string, s2: string) => {
    return s1.toLowerCase().includes(s2.toLowerCase());
};

export const isBlacklisted = (entity_id: string, blacklisted: (string | RegExp)[]) => {
    return blacklisted.some((blacklistItem) => {
        if (typeof blacklistItem === "string") {
            return normalizeIncludes(entity_id, blacklistItem);
        } else {
            return blacklistItem.test(entity_id);
        }
    });
};

const lightAttributes = ["brightness"];
const fanAttributes = ["percentage"];
const climateAttributes = ["preset_mode"];

const domains = ["light", "switch", "fan", "climate", "lock", "cover", "media_player"];
/**
 * Filters a list of attributes based on valid state attributes of a given entity.
 * These are the states that we'll save when caching.
 *
 * @param domain entity domain.
 * @param service entity service.
 * @param attributes entity attributes to cache.
 */
const filterAttributes = function (
    domain: string,
    service: string,
    attributes: Hass.Attribute
) {
    let data = {};

    switch (domain) {
        case "light": {
            const colorMode = attributes["color_mode"];
            if (attributes[colorMode] != undefined) {
                data[colorMode] = attributes[colorMode];
            }
            lightAttributes.forEach((x) => setIfExists(data, attributes, x));
            break;
        }
        case "fan": {
            fanAttributes.forEach((x) => setIfExists(data, attributes, x));
            break;
        }
        case "climate": {
            climateAttributes.forEach((x) => setIfExists(data, attributes, x));
            break;
        }
    }

    return data;
};

/**
 * Maps an input entity's domain to an appropriate service for
 * later caching.
 *
 * light -> turn_[on, off], for example.
 *
 * @param entity input hass entity.
 * @param domain domain thereof.
 */
export const mapDomainToService = function (entity: Hass.State, domain: string) {
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
        case "lock": {
            switch (entity.state) {
                case "locked":
                    return "lock";
                case "unlocked":
                    return "unlock";
            }
            break;
        }
        case "cover": {
            switch (entity.state) {
                case "open":
                    return "open_cover";
                case "closed":
                    return "close_cover";
            }
            break;
        }
        case "climate": {
            return "set_preset_mode";
        }
    }
    return undefined;
};

export const createServiceCall = (entity: Hass.State) => {
    const domain = getEntityDomain(entity.entity_id);
    const service = mapDomainToService(entity, domain);

    if (!domains.includes(domain) || service === undefined) {
        return undefined;
    }

    return {
        domain: domain,
        service: service,
        data: {
            entity_id: entity.entity_id,
            state: entity.state,
            ...filterAttributes(domain, service, entity.attributes)
        }
    };
};

export const createStatesMap = (
    states: Partial<Hass.Service>[]
): Map<string, Partial<Hass.Service>> => {
    return new Map(states.map((state) => [state.data.entity_id, state]));
};
