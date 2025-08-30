export const GLOBAL_CACHED_STATES_KEY = "cachedStates";

export function getEntityBasename(entity: Partial<Hass.State> | string): string {
    const entityId = typeof entity === "string" ? entity : entity.entity_id;
    const match = entityId.match(/^.*\.(.*)$/);

    return match ? match[1] : entityId;
}

export function getEntityDomain(entity: Partial<Hass.State> | string): string {
    const entityId = typeof entity === "string" ? entity : entity.entity_id;
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

export function compareTime(
    time1: Date,
    time2: Date,
    withDay: boolean = false
): number {
    let t1 = time1.getHours() * 3600 + time1.getMinutes() * 60 + time1.getSeconds();
    let t2 = time2.getHours() * 3600 + time2.getMinutes() * 60 + time2.getSeconds();

    if (withDay) {
        t1 += time1.getDate() * 86400;
        t2 += time2.getDate() * 86400;
    }

    return t1 === t2 ? 0 : t1 > t2 ? 1 : -1;
}

export function isTimeInRange(current: Date, start: Date, end: Date): boolean {
    return (
        compareTime(current, start, true) >= 0 && compareTime(current, end, true) <= 0
    );
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

export const deepEqual = (a: any, b: any): boolean => {
    if (a === b) {
        return true;
    }

    if (typeof a !== "object" || typeof b !== "object") {
        return false;
    }

    if (Object.keys(a).length !== Object.keys(b).length) {
        return false;
    }

    for (const key in a) {
        if (!(key in b)) {
            return false;
        }

        if (!deepEqual(a[key], b[key])) {
            return false;
        }
    }

    return true;
};

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

// Ignore the car, and all grow lights.
const BLACKLISTED_ENTITIES = [
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

export const filterBlacklistedEntity = (
    entity: Partial<Hass.State> | string,
    blacklist: (string | RegExp)[] = BLACKLISTED_ENTITIES
) => {
    // check if the object is an entity, or just an entity_id
    let entity_id: string;
    let state: string;

    if (typeof entity === "string") {
        entity_id = entity;
        state = undefined;
    } else {
        entity_id = entity.entity_id;
        state = entity.state;
    }

    const whitelisted = !isBlacklisted(entity_id, blacklist);

    const inDomain = domains ? domains.includes(getEntityDomain(entity_id)) : true;

    const isUnavailable = state === "unavailable" || state === "unknown";

    return whitelisted && inDomain && !isUnavailable;
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
            // color mode might also end in _color
            const colorModeColor = `${colorMode}_color`;
            if (attributes[colorModeColor] != undefined) {
                data[colorModeColor] = attributes[colorModeColor];
            }

            // If the light is being turned off, we don't need to save the brightness.
            if (service === "turn_off") {
                break;
            }

            lightAttributes.forEach((x) => setIfExists(data, attributes, x));
            break;
        }
        case "fan": {
            // If the fan is being turned off, we don't need to save the percentage.
            if (service === "turn_off") {
                break;
            }

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
export const domainToService = function (entity: Hass.State, domain: string) {
    switch (domain) {
        case "switch":
        case "light":
        case "fan": {
            return `turn_${entity.state}`;
        }
        case "input_boolean": {
            return entity.state === "on" ? "turn_on" : "turn_off";
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
                default:
                    return entity.state === "on" ? "lock" : "unlock";
            }
        }
        case "cover": {
            switch (entity.state) {
                case "open":
                    return "open_cover";
                case "closed":
                    return "close_cover";
                default:
                    return entity.state === "on" ? "open_cover" : "close_cover";
            }
        }
        case "climate": {
            switch (entity.state) {
                case "off":
                    return "turn_off";
                default:
                    return "set_preset_mode";
            }
        }
        case "vacuum": {
            switch (entity.state) {
                case "cleaning":
                    return "start";
                case "docked":
                    return "return_to_base";
                case "paused":
                    return "pause";
                case "idle":
                    return "stop";
                default:
                    return "stop";
            }
        }
        case "input_select":
        case "select":
            return "select_option";
        case "button":
        case "number":
        case "sensor":
        case "binary_sensor":
            // These domains don't support turn_on/turn_off
            return undefined;
        default: {
            // Generic fallback for unknown domains
            if (entity.state === "on") return "turn_on";
            if (entity.state === "off") return "turn_off";
            return undefined;
        }
    }
};

export const createServiceCall = (entity: Hass.State): Hass.Service | undefined => {
    const domain = getEntityDomain(entity);
    const service = domainToService(entity, domain);

    // If the entity is not in the domain list, or the service is undefined,
    // return undefined.
    if (!domains.includes(domain) || service === undefined) {
        return undefined;
    }

    return {
        domain: domain,
        service: service,
        data: {
            entity_id: entity.entity_id,
            // state: entity.state,
            ...filterAttributes(domain, service, entity.attributes as Hass.Attribute)
        }
    };
};

// Converts a service call to state, with data from the service call.
// turn_on -> on
// turn_off -> off
// light.turn_on with brightness 50% -> { state: "on", data: { brightness: 50 } }
// etc.
export const serviceCallToState = (
    serviceCall: Hass.Service & Hass.Action
): Partial<Hass.State> => {
    const {
        domain,
        data: { entity_id }
    } = serviceCall;

    const service = serviceCall.service || serviceCall.action;

    const serviceData = JSON.parse(JSON.stringify(serviceCall.data));

    // Delete the entity_id field from the data object to avoid duplication:
    delete serviceData.entity_id;

    switch (domain) {
        case "light":
        case "switch":
        case "fan": {
            return {
                entity_id,
                state: service === "turn_on" ? "on" : "off",
                attributes: serviceData
            };
        }
        case "media_player": {
            return {
                entity_id,
                state: service === "turn_on" ? "on" : "off",
                attributes: serviceData
            };
        }
        case "lock": {
            return {
                entity_id,
                state: service === "lock" ? "locked" : "unlocked",
                attributes: serviceData
            };
        }
        case "cover": {
            return {
                entity_id,
                state: service === "open_cover" ? "open" : "closed",
                attributes: serviceData
            };
        }
        case "climate": {
            switch (service) {
                case "set_preset_mode": {
                    return {
                        entity_id,
                        state: serviceData.preset_mode,
                        attributes: serviceData
                    };
                }
            }
        }
    }
};

export const serviceToActionCall = (
    call: Partial<Hass.Service> | Partial<Hass.Action>
): Partial<Hass.Action> => {
    // If the service call is already an action, return it as is:
    // @ts-ignore
    if (call?.action != null) {
        return call;
    }

    const serviceCall = call as Partial<Hass.Service>;

    const out = {
        ...serviceCall,
        action: `${serviceCall.domain}.${serviceCall.service}`,

        target: {
            entity_id: serviceCall.data.entity_id
        }
    };

    // Remove the domain and service fields:
    delete out.domain;
    delete out.service;

    return out;
};

export const createAwayPayload = (states: Hass.Service[]) => {
    return states
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

        .flat()
        .filter(Boolean);
};

// Groups a series of actions into a single action based on the:
// - action type
// - data payload
// - target entity ids
export const groupActions = (
    actions: Partial<Hass.Action>[]
): Partial<Hass.Action>[] => {
    const grouped = actions.reduce((acc, cur) => {
        const { action, data, target } = cur;

        // Remove the "entity_id" field from the data object to avoid duplication:
        const dataCopy = { ...data };
        delete dataCopy.entity_id;

        const key = `${action}-${JSON.stringify(dataCopy)}`;

        if (!acc[key]) {
            acc[key] = {
                action,
                data: dataCopy,
                target: {
                    entity_id: new Set([target.entity_id])
                }
            };
        } else {
            acc[key].target.entity_id.add(target.entity_id);
        }

        return acc;
    }, {});

    // Reformat the grouped entity ids to an array:
    // @ts-ignore
    return Object.values(grouped).map((x) => {
        // @ts-ignore
        x.target.entity_id = Array.from(x.target.entity_id);
        return x;
    });
};

export const createStatesMap = (
    states: Partial<Hass.Service>[],
    basename: boolean = false
): Map<string, Partial<Hass.Service>> => {
    return new Map(
        states
            .filter((state) => state?.data?.entity_id != undefined)
            .map((state) => {
                const name = basename
                    ? getEntityBasename(state.data.entity_id)
                    : state.data.entity_id;

                return [name, state];
            })
    );
};

export const createStatesObject = (
    states: Partial<Hass.State>[],
    basename: boolean = false
): Record<string, Partial<Hass.State>> => {
    // @ts-ignore
    return states.reduce((acc, state) => {
        if (state?.entity_id != undefined) {
            const name = basename
                ? getEntityBasename(state)
                : state.entity_id;

            acc[name] = state;
        }
        return acc;
    }, {});
};

export function mapRange(
    value: number,
    fromMin: number,
    fromMax: number,
    toMin: number,
    toMax: number
): number {
    return ((value - fromMin) * (toMax - toMin)) / (fromMax - fromMin) + toMin;
}

export function lerp(value: number, min: number, max: number): number {
    // Linear interpolation: returns 0-1 representing where value falls between min and max
    const t = (value - min) / (max - min);
    return Math.min(1, Math.max(0, t));
}

export const parseFloatIfString = (value: string | number): number => {
    return typeof value === "string" ? parseFloat(value) : value;
};

// Simple TTL cache for expensive operations
interface CacheEntry<T> {
    data: T;
    timestamp: number;
}

const cache: Map<string, CacheEntry<any>> = new Map();

/**
 * Simple TTL cache decorator
 * @param key Cache key
 * @param ttlMs Time to live in milliseconds
 * @param fetcher Function to fetch data if cache miss
 */
export function withTTL<T>(key: string, ttlMs: number, fetcher: () => T): T {
    const now = Date.now();
    const cached = cache.get(key);

    if (cached && now - cached.timestamp < ttlMs) {
        return cached.data;
    }

    const data = fetcher();
    cache.set(key, { data, timestamp: now });
    return data;
}

/**
 * Deserialize RegExp objects from Node-RED flow context
 * Flow context serializes RegExp as {__enc__: true, type: "regexp", data: "/pattern/flags"}
 */
export function deserializeRegExp(obj: any): any {
    if (obj && obj.__enc__ && obj.type === "regexp" && obj.data) {
        // Extract pattern and flags from the serialized format
        // Use a more permissive regex that handles escaped content
        const match = obj.data.match(/^\/(.*)\/([gimuy]*)$/);
        if (match) {
            try {
                // The pattern might have escaped backslashes from JSON serialization
                // Replace \\ with \ to get the actual pattern
                const pattern = match[1].replace(/\\\\/g, "\\");
                return new RegExp(pattern, match[2] || "");
            } catch (e) {
                console.error("Failed to create RegExp:", e, "Pattern:", match[1]);
                // If RegExp construction fails, return original
                return obj;
            }
        }
    }
    return obj;
}

/**
 * Recursively deserialize an object, converting serialized RegExp objects
 */
export function deserializeObject<T = any>(obj: T): T {
    if (obj === null || obj === undefined) return obj;

    if (Array.isArray(obj)) {
        return obj.map((item) => deserializeObject(item)) as any;
    }

    if (typeof obj === "object") {
        // Check if it's a serialized RegExp
        if ((obj as any).__enc__) {
            return deserializeRegExp(obj) as any;
        }

        // Recursively deserialize object properties
        const result: any = {};
        for (const [key, value] of Object.entries(obj)) {
            result[key] = deserializeObject(value);
        }
        return result;
    }

    return obj;
}
