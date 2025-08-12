import {
    serviceToActionCall,
    groupActions,
    domainToService,
    getEntityDomain,
    filterBlacklistedEntity,
    createServiceCall,
    createStatesMap,
    deepEqual
} from "../utils/utils";
import {
    getEntity,
    getEntitiesById,
    getEntitiesByPattern,
    filterAvailableEntities
} from "../utils/ha-entities";

interface ServiceCallConfig {
    groupActions?: boolean;
    filterBlacklisted?: boolean;
    filterUnavailable?: boolean;
    validateDomain?: boolean;
    ensureActionFormat?: boolean;
}

function processServiceCall(
    serviceCall: Partial<Hass.Service>,
    config: ServiceCallConfig = {}
): Partial<Hass.Action> | null {
    const {
        filterBlacklisted = true,
        filterUnavailable = true,
        validateDomain = true
    } = config;

    // Extract entity_id from the service call
    const entityId = serviceCall.data?.entity_id;
    if (!entityId) {
        console.warn("Service call missing entity_id:", serviceCall);
        return null;
    }

    // Filter blacklisted entities if configured
    if (filterBlacklisted && !filterBlacklistedEntity(entityId)) {
        console.log(`Filtered blacklisted entity: ${entityId}`);
        return null;
    }

    // Get entity state to validate availability
    if (filterUnavailable && typeof entityId === "string") {
        const entity = getEntity(entityId);
        if (entity && (entity.state === "unavailable" || entity.state === "unknown")) {
            console.log(`Filtered unavailable entity: ${entityId}`);
            return null;
        }
    }

    // Validate domain if configured
    if (validateDomain && serviceCall.domain) {
        const actualDomain = getEntityDomain(entityId as string);
        if (actualDomain !== serviceCall.domain) {
            console.warn(`Domain mismatch for ${entityId}: expected ${serviceCall.domain}, got ${actualDomain}`);
            // Auto-correct the domain
            serviceCall.domain = actualDomain;
        }
    }

    // Convert to action format
    return serviceToActionCall(serviceCall);
}

function ensureServiceFormat(input: any): Partial<Hass.Service> | null {
    // Handle action format (already has action field)
    if (input.action && !input.service) {
        const [domain, service] = input.action.split(".");
        return {
            domain,
            service,
            data: input.data || input.target || {}
        };
    }

    // Handle service format (has domain and service)
    if (input.domain && input.service) {
        return {
            domain: input.domain,
            service: input.service,
            data: input.data || {}
        };
    }

    // Handle entity state conversion
    if (input.entity_id && input.state !== undefined) {
        const entity: Partial<Hass.State> = {
            entity_id: input.entity_id,
            state: input.state,
            attributes: input.attributes || {}
        };
        return createServiceCall(entity as Hass.State);
    }

    // Invalid format
    console.warn("Invalid service call format:", input);
    return null;
}

function mergeServiceData(
    base: Record<string, any>,
    additional: Record<string, any>
): Record<string, any> {
    const merged = { ...base };

    for (const [key, value] of Object.entries(additional)) {
        if (key === "entity_id") continue; // Skip entity_id as it's handled in target

        if (merged[key] === undefined) {
            merged[key] = value;
        } else if (typeof merged[key] === "object" && typeof value === "object") {
            // Deep merge objects
            merged[key] = { ...merged[key], ...value };
        }
    }

    return merged;
}

// Main processing logic
// @ts-ignore
const input = msg.payload;
// @ts-ignore
const config: ServiceCallConfig = msg.config || {};

// Default configuration
const defaultConfig: ServiceCallConfig = {
    groupActions: true,
    filterBlacklisted: true,
    filterUnavailable: true,
    validateDomain: true,
    ensureActionFormat: true
};

// Merge configurations
const finalConfig = { ...defaultConfig, ...config };

let serviceCalls: Partial<Hass.Service>[] = [];

// Handle different input formats
if (Array.isArray(input)) {
    // Array of service calls or entities
    serviceCalls = input
        .map(ensureServiceFormat)
        .filter((call): call is Partial<Hass.Service> => call !== null);
} else if (typeof input === "object" && input !== null) {
    // Single service call or entity
    const serviceCall = ensureServiceFormat(input);
    if (serviceCall) {
        serviceCalls = [serviceCall];
    }
} else {
    console.error("Invalid input format for service-call conversion:", input);
    serviceCalls = [];
}

// Process each service call
const actions: Partial<Hass.Action>[] = [];
const skippedEntities: string[] = [];
const processedEntities: string[] = [];

for (const serviceCall of serviceCalls) {
    const action = processServiceCall(serviceCall, finalConfig);
    
    if (action) {
        actions.push(action);
        const entityId = action.target?.entity_id;
        if (entityId) {
            processedEntities.push(
                Array.isArray(entityId) ? entityId.join(", ") : entityId as string
            );
        }
    } else {
        const entityId = serviceCall.data?.entity_id;
        if (entityId) {
            skippedEntities.push(
                Array.isArray(entityId) ? entityId.join(", ") : entityId as string
            );
        }
    }
}

// Group actions if configured
const finalActions = finalConfig.groupActions 
    ? groupActions(actions) 
    : actions;

// Create debug info
const debugInfo = {
    inputCount: Array.isArray(input) ? input.length : 1,
    processedCount: processedEntities.length,
    skippedCount: skippedEntities.length,
    actionCount: finalActions.length,
    grouped: finalConfig.groupActions,
    config: finalConfig
};

// Add details if there are skipped entities
if (skippedEntities.length > 0) {
    debugInfo["skippedEntities"] = skippedEntities.slice(0, 10); // Limit to first 10 for readability
}

// Output
// @ts-ignore
msg.payload = finalActions;
// @ts-ignore
msg.debug = debugInfo;
// @ts-ignore
msg.processedEntities = processedEntities;