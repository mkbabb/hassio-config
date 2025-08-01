// Home Assistant entity fetching utilities
import { withTTL, getEntityDomain, filterBlacklistedEntity } from './utils';

export interface EntityFilter {
    pattern?: string | RegExp;
    domain?: string | string[];
    area?: string | string[];
    device_class?: string | string[];
    attributes?: Record<string, any>;
}

/**
 * Get all entities from Home Assistant global state cache
 * Cached with 5 second TTL to reduce global context access
 */
export function getAllEntities(): Record<string, Hass.State> | null {
    return withTTL('all-entities', 5000, () => {
        // @ts-ignore - Note: lowercase 'homeassistant' is correct
        const states = global.get("homeassistant.homeAssistant.states");
        return states || null;
    });
}

/**
 * Get a single entity by ID - uses direct access for performance
 */
export function getEntity(entityId: string): Hass.State | null {
    // Direct access to specific entity - much more efficient
    // @ts-ignore - Note: lowercase 'homeassistant' is correct
    const entity = global.get(`homeassistant.homeAssistant.states['${entityId}']`);
    return entity || null;
}

/**
 * Get multiple entities by ID - uses direct access
 * Much more efficient than getAllEntities when you know the IDs
 */
export function getEntitiesById(entityIds: string[]): Record<string, Hass.State> {
    const result: Record<string, Hass.State> = {};
    
    for (const entityId of entityIds) {
        const entity = getEntity(entityId);
        if (entity) {
            result[entityId] = entity;
        }
    }
    
    return result;
}

/**
 * Check if an entity exists without fetching its state
 */
export function entityExists(entityId: string): boolean {
    // @ts-ignore
    return global.get(`homeAssistant.homeAssistant.states['${entityId}']`) !== undefined;
}

/**
 * Get entities matching a filter
 */
export function getEntities(filter: EntityFilter): Hass.State[] {
    const states = getAllEntities();
    if (!states) return [];
    
    const entities = Object.values(states);
    
    return entities.filter(entity => {
        // Pattern matching
        if (filter.pattern) {
            const pattern = filter.pattern instanceof RegExp 
                ? filter.pattern 
                : new RegExp(filter.pattern);
            if (!pattern.test(entity.entity_id)) return false;
        }
        
        // Domain filtering
        if (filter.domain) {
            const domains = Array.isArray(filter.domain) ? filter.domain : [filter.domain];
            const entityDomain = getEntityDomain(entity.entity_id);
            if (!domains.includes(entityDomain)) return false;
        }
        
        // Area filtering (if area_id is in attributes)
        if (filter.area && entity.attributes.area_id) {
            const areas = Array.isArray(filter.area) ? filter.area : [filter.area];
            if (!areas.includes(entity.attributes.area_id)) return false;
        }
        
        // Device class filtering
        if (filter.device_class && entity.attributes.device_class) {
            const classes = Array.isArray(filter.device_class) ? filter.device_class : [filter.device_class];
            if (!classes.includes(entity.attributes.device_class)) return false;
        }
        
        // Attribute matching
        if (filter.attributes) {
            for (const [key, value] of Object.entries(filter.attributes)) {
                if (entity.attributes[key] !== value) return false;
            }
        }
        
        return true;
    });
}

/**
 * Get entities by domain (e.g., "light", "switch", "sensor")
 * Optimized to only iterate through entities once per domain
 */
export function getEntitiesByDomain(domain: string | string[]): Hass.State[] {
    const domains = Array.isArray(domain) ? domain : [domain];
    const cacheKey = `entities-by-domain-${domains.sort().join(',')}`;
    
    return withTTL(cacheKey, 5000, () => {
        const allStates = getAllEntities();
        if (!allStates) return [];
        
        const result: Hass.State[] = [];
        
        // Single pass through all entities
        for (const [entityId, state] of Object.entries(allStates)) {
            const entityDomain = getEntityDomain(entityId);
            if (domains.includes(entityDomain)) {
                result.push(state);
            }
        }
        
        return result;
    });
}

/**
 * Get entities by pattern (string or RegExp)
 * Optimized with caching for common patterns
 */
export function getEntitiesByPattern(pattern: string | RegExp): Hass.State[] {
    // For RegExp, use string representation as cache key
    const cacheKey = `entities-by-pattern-${pattern instanceof RegExp ? pattern.source : pattern}`;
    
    return withTTL(cacheKey, 5000, () => {
        const allStates = getAllEntities();
        if (!allStates) return [];
        
        const regex = pattern instanceof RegExp ? pattern : new RegExp(pattern);
        const result: Hass.State[] = [];
        
        // Single pass through all entities
        for (const [entityId, state] of Object.entries(allStates)) {
            if (regex.test(entityId)) {
                result.push(state);
            }
        }
        
        return result;
    });
}

/**
 * Get input_datetime entities for schedules
 */
export function getScheduleEntities(): Hass.State[] {
    return getEntitiesByDomain('input_datetime');
}

/**
 * Convert entity array to object keyed by entity_id
 */
export function entitiesToObject(entities: Hass.State[]): Record<string, Hass.State> {
    return entities.reduce((acc, entity) => {
        acc[entity.entity_id] = entity;
        return acc;
    }, {} as Record<string, Hass.State>);
}

/**
 * Match entities against multiple patterns
 */
export function matchEntitiesMultiple(patterns: (string | RegExp)[]): Hass.State[] {
    const states = getAllEntities();
    if (!states) return [];
    
    const regexps = patterns.map(p => 
        p instanceof RegExp ? p : new RegExp(p)
    );
    
    return Object.values(states).filter(entity =>
        regexps.some(regex => regex.test(entity.entity_id))
    );
}

/**
 * Filter out unavailable, unknown, or blacklisted entities
 */
export function filterAvailableEntities(entities: Hass.State[]): Hass.State[] {
    return entities.filter(entity => 
        entity.state !== 'unavailable' && 
        entity.state !== 'unknown' &&
        filterBlacklistedEntity(entity)
    );
}

/**
 * Group entities by domain
 */
export function groupEntitiesByDomain(entities: Hass.State[]): Record<string, Hass.State[]> {
    return entities.reduce((acc, entity) => {
        const domain = getEntityDomain(entity.entity_id);
        if (!acc[domain]) acc[domain] = [];
        acc[domain].push(entity);
        return acc;
    }, {} as Record<string, Hass.State[]>);
}