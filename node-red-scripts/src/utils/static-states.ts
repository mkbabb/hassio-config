/**
 * Static States and Blacklist Management
 * Manages entity state overrides and blacklists with namespace support.
 * Also tracks external modifications (state changes not initiated by our automation).
 */

// Type definitions
export interface StaticStates {
    [namespace: string]: {
        [entityId: string]: string;
    };
}

export interface StaticBlacklist {
    [namespace: string]: string[];
}

// External modification tracking
export interface ExternalModification {
    entityId: string;
    expectedState: string;      // What our automation set it to
    actualState: string;        // What it changed to externally
    detectedAt: number;         // Timestamp of detection
    scheduleName?: string;      // Which schedule was controlling this entity
}

export interface ExternalModificationRegistry {
    modifications: Record<string, ExternalModification>;  // keyed by entity_id
    lastCleared: number | null;
}

const EXTERNAL_MOD_KEY = "externalModifications";

// Initialize and get static states for a namespace
export function getStaticStates(namespace: string = 'default'): Record<string, string> {
    // @ts-ignore - global is provided by Node-RED
    let staticStates = global.get('staticStates') as StaticStates | undefined;
    
    if (!staticStates) {
        staticStates = {};
        // @ts-ignore
        global.set('staticStates', staticStates);
    }
    
    if (!staticStates[namespace]) {
        staticStates[namespace] = {};
        // @ts-ignore
        global.set('staticStates', staticStates);
    }
    
    return staticStates[namespace];
}

// Set a static state for an entity in a namespace
export function setStaticState(entityId: string, state: string, namespace: string = 'default'): void {
    const states = getStaticStates(namespace);
    states[entityId] = state;
    
    // @ts-ignore
    const staticStates = global.get('staticStates') as StaticStates;
    staticStates[namespace] = states;
    // @ts-ignore
    global.set('staticStates', staticStates);
}

// Remove a static state for an entity in a namespace
export function removeStaticState(entityId: string, namespace: string = 'default'): void {
    const states = getStaticStates(namespace);
    delete states[entityId];
    
    // @ts-ignore
    const staticStates = global.get('staticStates') as StaticStates;
    staticStates[namespace] = states;
    // @ts-ignore
    global.set('staticStates', staticStates);
}

// Get blacklist for a namespace
export function getBlacklist(namespace: string = 'default'): string[] {
    // @ts-ignore
    let blacklists = global.get('staticBlacklist') as StaticBlacklist | undefined;
    
    if (!blacklists) {
        blacklists = {};
        // @ts-ignore
        global.set('staticBlacklist', blacklists);
    }
    
    if (!blacklists[namespace]) {
        blacklists[namespace] = [];
        // @ts-ignore
        global.set('staticBlacklist', blacklists);
    }
    
    return blacklists[namespace];
}

// Add entity to blacklist in a namespace
export function addToBlacklist(entityId: string, namespace: string = 'default'): void {
    const blacklist = getBlacklist(namespace);
    
    if (!blacklist.includes(entityId)) {
        blacklist.push(entityId);
        
        // @ts-ignore
        const blacklists = global.get('staticBlacklist') as StaticBlacklist;
        blacklists[namespace] = blacklist;
        // @ts-ignore
        global.set('staticBlacklist', blacklists);
    }
}

// Remove entity from blacklist in a namespace
export function removeFromBlacklist(entityId: string, namespace: string = 'default'): void {
    const blacklist = getBlacklist(namespace);
    const index = blacklist.indexOf(entityId);
    
    if (index !== -1) {
        blacklist.splice(index, 1);
        
        // @ts-ignore
        const blacklists = global.get('staticBlacklist') as StaticBlacklist;
        blacklists[namespace] = blacklist;
        // @ts-ignore
        global.set('staticBlacklist', blacklists);
    }
}

// Check if entity is blacklisted (in any namespace or specific namespace)
export function isBlacklisted(entityId: string, namespace?: string): boolean {
    if (namespace) {
        const blacklist = getBlacklist(namespace);
        return blacklist.includes(entityId);
    }
    
    // Check all namespaces
    // @ts-ignore
    const blacklists = global.get('staticBlacklist') as StaticBlacklist | undefined;
    if (!blacklists) return false;
    
    for (const ns in blacklists) {
        if (blacklists[ns].includes(entityId)) {
            return true;
        }
    }
    
    return false;
}

// Check if entity has a static state override (in any namespace or specific namespace)
export function hasStaticState(entityId: string, namespace?: string): boolean {
    if (namespace) {
        const states = getStaticStates(namespace);
        return entityId in states;
    }
    
    // Check all namespaces
    // @ts-ignore
    const staticStates = global.get('staticStates') as StaticStates | undefined;
    if (!staticStates) return false;
    
    for (const ns in staticStates) {
        if (entityId in staticStates[ns]) {
            return true;
        }
    }
    
    return false;
}

// Get static state for an entity (searches all namespaces if namespace not specified)
export function getStaticState(entityId: string, namespace?: string): string | undefined {
    if (namespace) {
        const states = getStaticStates(namespace);
        return states[entityId];
    }
    
    // Search all namespaces
    // @ts-ignore
    const staticStates = global.get('staticStates') as StaticStates | undefined;
    if (!staticStates) return undefined;
    
    for (const ns in staticStates) {
        if (entityId in staticStates[ns]) {
            return staticStates[ns][entityId];
        }
    }
    
    return undefined;
}

// Check if entity should be filtered (blacklisted or has static state)
export function shouldFilterEntity(
    entityId: string,
    options: {
        checkBlacklist?: boolean;
        checkStaticState?: boolean;
        namespace?: string;
        additionalBlacklist?: string[];
    } = {}
): boolean {
    const {
        checkBlacklist = true,
        checkStaticState = true,
        namespace,
        additionalBlacklist = []
    } = options;
    
    // Check additional blacklist first (e.g., from msg.blacklist)
    if (additionalBlacklist.includes(entityId)) {
        return true;
    }
    
    // Check blacklist
    if (checkBlacklist && isBlacklisted(entityId, namespace)) {
        return true;
    }
    
    // Check static state
    if (checkStaticState && hasStaticState(entityId, namespace)) {
        return true;
    }
    
    return false;
}

// Get all filtered entities (combines blacklist and static states)
export function getFilteredEntities(namespace?: string): Set<string> {
    const filtered = new Set<string>();
    
    if (namespace) {
        // Get from specific namespace
        const blacklist = getBlacklist(namespace);
        const states = getStaticStates(namespace);
        
        blacklist.forEach(id => filtered.add(id));
        Object.keys(states).forEach(id => filtered.add(id));
    } else {
        // Get from all namespaces
        // @ts-ignore
        const blacklists = global.get('staticBlacklist') as StaticBlacklist | undefined;
        if (blacklists) {
            for (const ns in blacklists) {
                blacklists[ns].forEach(id => filtered.add(id));
            }
        }
        
        // @ts-ignore
        const staticStates = global.get('staticStates') as StaticStates | undefined;
        if (staticStates) {
            for (const ns in staticStates) {
                Object.keys(staticStates[ns]).forEach(id => filtered.add(id));
            }
        }
    }
    
    return filtered;
}

// Clear all static states and blacklists for a namespace
export function clearNamespace(namespace: string): void {
    // @ts-ignore
    const staticStates = global.get('staticStates') as StaticStates | undefined;
    if (staticStates && staticStates[namespace]) {
        delete staticStates[namespace];
        // @ts-ignore
        global.set('staticStates', staticStates);
    }

    // @ts-ignore
    const blacklists = global.get('staticBlacklist') as StaticBlacklist | undefined;
    if (blacklists && blacklists[namespace]) {
        delete blacklists[namespace];
        // @ts-ignore
        global.set('staticBlacklist', blacklists);
    }
}

// Remove a static state for an entity across ALL namespaces
export function removeStaticStateAllNamespaces(entityId: string): number {
    // @ts-ignore
    const staticStates = global.get('staticStates') as StaticStates | undefined;
    if (!staticStates) return 0;

    let removed = 0;
    for (const ns in staticStates) {
        if (entityId in staticStates[ns]) {
            delete staticStates[ns][entityId];
            removed++;
        }
    }

    if (removed > 0) {
        // @ts-ignore
        global.set('staticStates', staticStates);
    }
    return removed;
}

// Clear all static states across all namespaces (optionally exclude certain namespaces)
export function clearAllStaticStates(excludeNamespaces: string[] = []): number {
    // @ts-ignore
    const staticStates = global.get('staticStates') as StaticStates | undefined;
    if (!staticStates) return 0;

    let cleared = 0;
    for (const ns in staticStates) {
        if (excludeNamespaces.includes(ns)) continue;
        cleared += Object.keys(staticStates[ns]).length;
        delete staticStates[ns];
    }

    // @ts-ignore
    global.set('staticStates', staticStates);
    return cleared;
}

// ============================================================================
// External Modification Tracking
// ============================================================================

// Get the external modification registry
export function getExternalModifications(): ExternalModificationRegistry {
    // @ts-ignore
    const registry = global.get(EXTERNAL_MOD_KEY) as ExternalModificationRegistry | undefined;
    return registry || { modifications: {}, lastCleared: null };
}

// Record an external modification (entity diverged from expected state)
export function recordExternalModification(
    entityId: string,
    expectedState: string,
    actualState: string,
    scheduleName?: string
): void {
    const registry = getExternalModifications();
    registry.modifications[entityId] = {
        entityId,
        expectedState,
        actualState,
        detectedAt: Date.now(),
        scheduleName
    };
    // @ts-ignore
    global.set(EXTERNAL_MOD_KEY, registry);

    // Also set a static state in the "external" namespace to block schedule enforcement
    setStaticState(entityId, actualState, "external");
}

// Check if an entity has been externally modified
export function isExternallyModified(entityId: string): boolean {
    const registry = getExternalModifications();
    return entityId in registry.modifications;
}

// Get external modification details for an entity
export function getExternalModification(entityId: string): ExternalModification | undefined {
    const registry = getExternalModifications();
    return registry.modifications[entityId];
}

// Clear external modification for a specific entity
export function clearExternalModification(entityId: string): boolean {
    const registry = getExternalModifications();
    if (!(entityId in registry.modifications)) return false;

    delete registry.modifications[entityId];
    // @ts-ignore
    global.set(EXTERNAL_MOD_KEY, registry);

    // Also remove the "external" namespace static state
    removeStaticState(entityId, "external");
    return true;
}

// Clear all external modifications for entities controlled by a specific schedule
export function clearExternalModificationsForSchedule(scheduleName: string): number {
    const registry = getExternalModifications();
    let cleared = 0;

    for (const [entityId, mod] of Object.entries(registry.modifications)) {
        if (mod.scheduleName === scheduleName) {
            delete registry.modifications[entityId];
            removeStaticState(entityId, "external");
            cleared++;
        }
    }

    if (cleared > 0) {
        // @ts-ignore
        global.set(EXTERNAL_MOD_KEY, registry);
    }
    return cleared;
}

// Clear ALL external modifications
export function clearAllExternalModifications(): number {
    const registry = getExternalModifications();
    const count = Object.keys(registry.modifications).length;

    // Remove all "external" namespace static states
    for (const entityId of Object.keys(registry.modifications)) {
        removeStaticState(entityId, "external");
    }

    registry.modifications = {};
    registry.lastCleared = Date.now();
    // @ts-ignore
    global.set(EXTERNAL_MOD_KEY, registry);
    return count;
}

// Prune stale external modifications older than maxAge (ms)
export function pruneExternalModifications(maxAgeMs: number = 24 * 60 * 60 * 1000): number {
    const registry = getExternalModifications();
    const cutoff = Date.now() - maxAgeMs;
    let pruned = 0;

    for (const [entityId, mod] of Object.entries(registry.modifications)) {
        if (mod.detectedAt < cutoff) {
            delete registry.modifications[entityId];
            removeStaticState(entityId, "external");
            pruned++;
        }
    }

    if (pruned > 0) {
        // @ts-ignore
        global.set(EXTERNAL_MOD_KEY, registry);
    }
    return pruned;
}

// Get summary stats for publishing as HA sensor
export function getExternalModificationSummary(): {
    count: number;
    entities: string[];
    schedules: string[];
    oldestMs: number | null;
} {
    const registry = getExternalModifications();
    const mods = Object.values(registry.modifications);
    const schedules = [...new Set(mods.map(m => m.scheduleName).filter(Boolean))] as string[];
    const oldest = mods.length > 0
        ? Math.min(...mods.map(m => m.detectedAt))
        : null;

    return {
        count: mods.length,
        entities: mods.map(m => m.entityId),
        schedules,
        oldestMs: oldest
    };
}