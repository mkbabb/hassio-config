/**
 * Presence area types for the data-driven presence registry
 */

import type { EntityState } from "../scheduling/types";

/** Resolve a PresenceSensorConfig to its entity_id string */
export const getSensorEntityId = (s: PresenceSensorConfig): string =>
    typeof s === "string" ? s : s.entity_id;

/** Check if a sensor config matches a given entity_id */
export const sensorMatchesEntity = (s: PresenceSensorConfig, entityId: string): boolean =>
    getSensorEntityId(s) === entityId;

/** Resolve a PresenceSensorConfig to a normalized object */
export const normalizeSensorConfig = (s: PresenceSensorConfig): { entity_id: string; triggerMode: "level" | "edge" } =>
    typeof s === "string" ? { entity_id: s, triggerMode: "level" } : s;

export interface PresenceTrackedEntity {
    entity_id: string;
    conditions?: PresenceCondition[];  // Per-entity conditions (all must pass for this entity to be controlled)
    states?: {
        on?: EntityState;   // Custom "on" behavior (default: turn_on)
        off?: EntityState;  // Custom "off" behavior (default: turn_off)
    };
}

export type ExternalOverridePolicy = "respect" | "ignore" | "extend";

export type PresenceSensorConfig = string | {
    entity_id: string;
    triggerMode: "level" | "edge";  // "level" = sustains presence (default), "edge" = momentary trigger only
};

export interface PresenceCondition {
    entity_id: string;
    state: string | string[];  // Required state(s) for entity control to occur
}

export interface PresenceAreaConfig {
    topic: string;                          // Room identifier (e.g., "guest_bathroom")
    sensors: PresenceSensorConfig[];        // Entity IDs that detect presence (string or config object)
    entities: PresenceTrackedEntity[];      // What to control
    coolDown: number;                       // Base cooldown in seconds (default 600)
    enabled: boolean;
    conditions?: PresenceCondition[];       // If present, ALL must be met for entity on/off actions
    externalOverridePolicy?: ExternalOverridePolicy;  // How to handle external entity changes (default: "respect")
    externalOverrideGracePeriod?: number;   // Extra seconds to add to cooldown when "extend" policy (default: 300)
    createdAt: string;
    updatedAt: string;
}

export interface PresenceRegistry {
    version: number;
    areas: Record<string, PresenceAreaConfig>;
    lastSeeded: string | null;
}
