/**
 * Service call utilities for Home Assistant
 * Consolidated domain→state→service mapping logic
 */

import { getEntityDomain } from "./utils";

// Domain state mappings - canonical source of truth
export const DOMAIN_STATES = {
    light: { on: "on", off: "off" },
    switch: { on: "on", off: "off" },
    fan: { on: "on", off: "off" },
    lock: { on: "locked", off: "unlocked" },
    cover: { on: "open", off: "closed" },
    media_player: { on: "playing", off: "off" },
    climate: { on: "heat", off: "off" },
    vacuum: { on: "cleaning", off: "docked" },
    person: { on: "home", off: "not_home" },
    device_tracker: { on: "home", off: "not_home" },
    binary_sensor: { on: "on", off: "off" },
    input_boolean: { on: "on", off: "off" },
    input_select: { on: "on", off: "off" }
} as const;

export type DomainStateKey = keyof typeof DOMAIN_STATES;

/**
 * Maps an input entity's domain to an appropriate service for caching
 *
 * @param entity - Input Home Assistant entity
 * @param domain - Domain thereof
 * @returns Service name (turn_on, turn_off, lock, etc.)
 */
export function domainToService(entity: Hass.State, domain: string): string | undefined {
    switch (domain) {
        case "switch":
        case "light":
        case "fan":
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
            // Check if entity has a specific position (partially open/closed)
            const position = entity.attributes?.["current_position"];

            // If position exists and is not fully open (100) or closed (0), use set_cover_position
            if (position != null && position > 0 && position < 100) {
                return "set_cover_position";
            }

            // Otherwise use standard open/close based on state
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
}

/**
 * Converts a service call to state representation
 *
 * @param serviceCall - Service call to convert
 * @returns Partial state object
 */
export function serviceCallToState(
    serviceCall: Hass.Service & Hass.Action
): Partial<Hass.State> {
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
            let state: string;
            if (service === "set_cover_position") {
                // Determine state based on position
                const position = serviceData.position;
                if (position === 0) {
                    state = "closed";
                } else if (position === 100) {
                    state = "open";
                } else {
                    state = "open"; // Partially open covers are still "open"
                }
            } else {
                state = service === "open_cover" ? "open" : "closed";
            }

            return {
                entity_id,
                state,
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
}

/**
 * Converts service call format to action format
 *
 * @param call - Service or action call
 * @returns Action format
 */
export function serviceToActionCall(
    call: Partial<Hass.Service> | Partial<Hass.Action>
): Partial<Hass.Action> {
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
}

/**
 * Groups multiple actions by action type and data payload
 * Consolidates entity IDs to reduce API calls
 *
 * @param actions - Array of actions to group
 * @returns Grouped actions
 */
export function groupActions(
    actions: Partial<Hass.Action>[]
): Partial<Hass.Action>[] {
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
}
