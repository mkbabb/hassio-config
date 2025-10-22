/**
 * Entity matching and normalization
 *
 * Handles flexible entity selection via:
 * - Exact entity IDs
 * - Regex patterns
 * - Tags
 * - Entity config objects with states
 */

import { getEntityDomain } from "../../utils/utils";
import type { EntityMatch, NormalizedEntityConfig, EntityConfig } from "../types";

/**
 * Normalizes various entity match formats into consistent config objects
 *
 * @param match - String, regex, array, or config object to normalize
 * @returns Array of normalized entity configurations with patterns
 */
export function normalizeEntityMatch(match: EntityMatch): NormalizedEntityConfig[] {
    if (!match) {
        return [{ pattern: new RegExp("(?!)") }];
    }

    // Handle arrays
    if (Array.isArray(match)) {
        return match.flatMap((m) => normalizeEntityMatch(m));
    }

    if (typeof match === "string") {
        // Check if it's a regex pattern with prefix
        if (match.startsWith("regex:")) {
            const pattern = match.substring(6); // Remove "regex:" prefix
            return [{ pattern: new RegExp(pattern) }];
        } else {
            // Plain string entity ID
            return [
                {
                    pattern: new RegExp(
                        `^${match.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`
                    )
                }
            ];
        }
    } else if (match instanceof RegExp) {
        // RegExp pattern
        return [{ pattern: match }];
    } else if (match && typeof match === "object") {
        // Check if it's an empty object {}
        if (Object.keys(match).length === 0) {
            return [{ pattern: new RegExp("(?!)") }];
        }

        // EntityConfig object
        const config = match as EntityConfig;

        // Check if entity_id exists
        if (!config.entity_id) {
            return [{ pattern: new RegExp("(?!)") }];
        }

        // Handle array of entity_ids in config
        if (Array.isArray(config.entity_id)) {
            return config.entity_id.map((id) => {
                const pattern =
                    id instanceof RegExp
                        ? id
                        : new RegExp(
                              `^${String(id).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`
                          );
                return {
                    pattern,
                    states: config.states
                };
            });
        }

        // Single entity_id
        const pattern =
            config.entity_id instanceof RegExp
                ? config.entity_id
                : new RegExp(
                      `^${String(config.entity_id).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`
                  );
        return [
            {
                pattern,
                states: config.states
            }
        ];
    }

    // Fallback
    return [{ pattern: new RegExp("(?!)") }];
}

/**
 * Checks if entity ID matches any configured patterns
 *
 * @param entityId - Entity to check
 * @param entityConfigs - Normalized configurations to match against
 * @returns Matching config or null
 */
export function matchesEntity(
    entityId: string,
    entityConfigs: NormalizedEntityConfig[] | undefined
): NormalizedEntityConfig | null {
    if (!entityConfigs) return null;

    for (const config of entityConfigs) {
        if (config.pattern.test(entityId)) {
            return config;
        }
    }
    return null;
}

/**
 * Checks if entity matches any defined tags
 *
 * @param entityId - Entity to check
 * @param tags - Tag names to match
 * @param tagDefinitions - Map of tag names to entity patterns
 * @param allowedDomains - Domains allowed for tag matching
 * @returns true if entity matches any tag
 */
export function matchesEntityByTag(
    entityId: string,
    tags: string[] | undefined,
    tagDefinitions: Record<string, string[]>,
    allowedDomains: string[] = [
        "light",
        "switch",
        "fan",
        "climate",
        "lock",
        "cover",
        "media_player"
    ]
): boolean {
    if (!tags || tags.length === 0) return false;

    // Check if entity domain is allowed
    const domain = getEntityDomain(entityId);
    if (!allowedDomains.includes(domain)) return false;

    for (const tag of tags) {
        const patterns = tagDefinitions[tag] || [];
        if (patterns.some((pattern) => new RegExp(pattern).test(entityId))) {
            return true;
        }
    }
    return false;
}
