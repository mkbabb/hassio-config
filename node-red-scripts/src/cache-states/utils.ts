/**
 * Cache-specific utilities for state management
 * Handles state snapshot creation, attribute filtering, and away mode payloads
 */

import { getEntityDomain, getEntityBasename, setIfExists } from "../utils/utils";
import { domainToService } from "../utils/service-calls";

// Attribute allowlists for different domains when caching states
const lightAttributes = ["brightness", "effect"];
const fanAttributes = ["percentage"];
const climateAttributes = ["preset_mode", "temperature", "hvac_mode"];
const coverAttributes = ["current_position"];
const mediaPlayerAttributes = ["volume_level", "is_volume_muted", "source"];

// Domains that support state caching
const domains = ["light", "switch", "fan", "climate", "lock", "cover", "media_player"];

/**
 * Filters entity attributes based on domain and service
 * Used when creating cache snapshots to preserve relevant state
 *
 * @param domain - Entity domain
 * @param service - Service being called
 * @param attributes - Full entity attributes
 * @returns Filtered attributes to cache
 */
export function filterAttributes(
    domain: string,
    service: string,
    attributes: Hass.Attribute
): Record<string, any> {
    let data = {};

    switch (domain) {
        case "light": {
            // Use color_mode to determine which color representation to save
            // This handles all color formats: hs_color, rgb_color, xy_color, rgbw_color, color_temp (mireds), etc.
            const colorMode = attributes["color_mode"];

            if (colorMode && attributes[colorMode] != undefined) {
                // Save the direct attribute (e.g., color_temp, brightness)
                data[colorMode] = attributes[colorMode];
            }

            // Many color modes use {mode}_color format (e.g., hs -> hs_color, rgb -> rgb_color)
            if (colorMode) {
                const colorModeColor = `${colorMode}_color`;
                if (attributes[colorModeColor] != undefined) {
                    data[colorModeColor] = attributes[colorModeColor];
                }
            }

            // If the light is being turned off, we don't need to save brightness/effect
            if (service === "turn_off") {
                break;
            }

            // Save standard attributes (brightness, effect) independent of color mode
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
        case "cover": {
            // If using set_cover_position, map current_position to position
            if (service === "set_cover_position") {
                const currentPosition = attributes["current_position"];
                if (currentPosition != null) {
                    data["position"] = currentPosition;
                }
            }
            // For open/close services, we don't need position data
            break;
        }
        case "media_player": {
            // If the media player is being turned off, we don't need attributes
            if (service === "turn_off") {
                break;
            }

            mediaPlayerAttributes.forEach((x) => setIfExists(data, attributes, x));
            break;
        }
    }

    return data;
}

/**
 * Creates a service call from an entity state for caching
 *
 * @param entity - Home Assistant entity state
 * @returns Service call object or undefined if not cacheable
 */
export function createServiceCall(entity: Hass.State): Hass.Service | undefined {
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
            ...filterAttributes(domain, service, entity.attributes as Hass.Attribute)
        }
    };
}

/**
 * Creates "away mode" payload from cached states
 * Converts normal states to away-appropriate states:
 * - Lights/switches: turn off
 * - Fans: low speed (33%)
 * - Climate: away preset
 * - Locks: locked
 * - Covers: closed
 * - Media players: off
 *
 * @param states - Array of cached service calls
 * @returns Array of away mode actions
 */
export function createAwayPayload(states: Hass.Service[]): Partial<Hass.Action>[] {
    return states
        .map((serviceCall) => {
            const {
                domain,
                data: { entity_id }
            } = serviceCall;

            const payload: any = { domain, data: { entity_id } };

            switch (domain) {
                case "switch":
                case "light": {
                    payload["service"] = "turn_off";
                    break;
                }
                case "fan": {
                    payload["service"] = "turn_on";
                    payload.data["percentage"] = 100 / 3; // ~33%
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
            payload["action"] = `${payload.domain}.${payload.service}`; // e.g. "light.turn_off"

            // New "target" field, which supports various ids:
            payload["target"] = {
                entity_id: entity_id
            };

            return payload;
        })
        .flat()
        .filter(Boolean);
}

/**
 * Creates a Map from service call array keyed by entity_id
 *
 * @param states - Array of service calls
 * @param basename - If true, key by entity basename instead of full ID
 * @returns Map of entity_id (or basename) to service call
 */
export function createStatesMap(
    states: Partial<Hass.Service>[],
    basename: boolean = false
): Map<string, Partial<Hass.Service>> {
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
}

/**
 * Creates an object from state array keyed by entity_id
 *
 * @param states - Array of entity states
 * @param basename - If true, key by entity basename instead of full ID
 * @returns Object keyed by entity_id (or basename)
 */
export function createStatesObject(
    states: Partial<Hass.State>[],
    basename: boolean = false
): Record<string, Partial<Hass.State>> {
    // @ts-ignore
    return states.reduce((acc, state) => {
        if (state?.entity_id != undefined) {
            const name = basename ? getEntityBasename(state) : state.entity_id;
            acc[name] = state;
        }
        return acc;
    }, {});
}
