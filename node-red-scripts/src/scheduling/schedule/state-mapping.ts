/**
 * State determination and service mapping
 *
 * Handles mapping between:
 * - Domains → target states (on/off, locked/unlocked, etc.)
 * - States → service calls (turn_on, lock, set_hvac_mode, etc.)
 * - Entities → complete service call objects
 */

import { getEntityDomain } from "../../utils/utils";
import { domainToService, DOMAIN_STATES } from "../../utils/service-calls";
import type { NormalizedSchedule, NormalizedEntityConfig, EntityState } from "../types";

/**
 * Determines target state for entity based on domain and schedule state
 *
 * @param domain - Entity domain (light, switch, climate, etc.)
 * @param isActive - Whether schedule is active
 * @param customState - Optional custom state configuration
 * @returns Target state string (on/off/heat/cool/etc.)
 */
export function getTargetState(
    domain: string,
    isActive: boolean,
    customState?: EntityState
): string {
    // Use custom state if provided
    if (customState?.state) {
        return customState.state;
    }

    // Get domain-specific states
    const domainStates = DOMAIN_STATES[domain as keyof typeof DOMAIN_STATES];
    if (domainStates) {
        return isActive ? domainStates.on : domainStates.off;
    }

    // Fallback to on/off
    return isActive ? "on" : "off";
}

/**
 * Maps entity state to appropriate service call
 *
 * @param domain - Entity domain
 * @param state - Target state
 * @param customService - Optional custom service override
 * @returns Service name (turn_on, turn_off, set_hvac_mode, etc.)
 */
export function getServiceForState(
    domain: string,
    state: string,
    customService?: string
): string {
    // Use custom service if provided
    if (customService) return customService;

    // Create a mock entity to leverage domainToService from utils
    const mockEntity: Partial<Hass.State> = {
        state: state,
        entity_id: `${domain}.mock`,
        attributes: {}
    };

    // Get service from utils domainToService
    const service = domainToService(mockEntity as Hass.State, domain);

    // If domainToService returned a valid service, use it
    if (service) {
        return service;
    }

    // Fallback for any edge cases not handled by domainToService
    return "set_state";
}

/**
 * Builds service call for entity based on schedule and current state
 *
 * @param entity - Current entity state
 * @param schedule - Active schedule configuration
 * @param entityConfig - Entity-specific configuration
 * @param isActive - Whether schedule is in active period
 * @returns Service call object or null if no action needed
 */
export function determineEntityAction(
    entity: Hass.State,
    schedule: NormalizedSchedule,
    entityConfig: NormalizedEntityConfig | null,
    isActive: boolean
): Partial<Hass.Service> | null {
    const domain = getEntityDomain(entity.entity_id);

    // Get the appropriate state config
    const stateKey = isActive ? "on" : "off";
    let stateConfig =
        entityConfig?.states?.[stateKey] || schedule.defaultStates?.[stateKey];

    // If no state config is defined, provide default turn_on/turn_off behavior
    if (!stateConfig) {
        stateConfig = {
            service: isActive ? "turn_on" : "turn_off"
        };
    }

    // For unidirectional schedules: if schedule is inactive and no "off" state is defined, skip
    // (This check is now after we've provided defaults, so only applies to explicitly null configs)
    if (!isActive && !stateConfig) {
        return null;
    }

    // Determine target state
    const targetState = getTargetState(domain, isActive, stateConfig);

    // Check if entity already in target state
    if (entity.state === targetState) return null;

    // Determine service to call
    const service = getServiceForState(domain, targetState, stateConfig?.service);

    // If no valid service for this domain, skip
    if (!service || service === "set_state") {
        return null;
    }

    // Build service data
    const serviceData: Record<string, any> = {
        entity_id: entity.entity_id,
        ...(stateConfig?.data || {})
    };

    // Add state-specific data
    if (domain === "climate" && service === "set_hvac_mode") {
        serviceData.hvac_mode = targetState;
    }

    return {
        domain: stateConfig?.domain || domain,
        service,
        data: serviceData
    };
}
