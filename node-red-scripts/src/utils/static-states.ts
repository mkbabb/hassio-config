/**
 * Static States and Blacklist Management
 * Manages entity state overrides and blacklists with namespace support
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