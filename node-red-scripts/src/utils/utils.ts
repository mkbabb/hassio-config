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

// DateTime functions moved to datetime.ts to eliminate duplication
// Import from './datetime' instead

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
    const isUnavailable = state === "unavailable" || state === "unknown";

    return whitelisted && !isUnavailable;
};

// ============================================================================
// CONSOLIDATED UTILITIES - Import from specialized modules
// ============================================================================

// Service call and domain mapping functions moved to service-calls.ts
// Import: domainToService, serviceCallToState, serviceToActionCall, groupActions
// from './service-calls'

// Cache-specific functions moved to cache-states/utils.ts
// Import: filterAttributes, createServiceCall, createAwayPayload, createStatesMap, createStatesObject
// from '../cache-states/utils'

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
