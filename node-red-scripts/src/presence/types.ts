/**
 * Presence area types for the data-driven presence registry
 */

import type { EntityState } from "../scheduling/types";

export interface PresenceTrackedEntity {
    entity_id: string;
    states?: {
        on?: EntityState;   // Custom "on" behavior (default: turn_on)
        off?: EntityState;  // Custom "off" behavior (default: turn_off)
    };
}

export type ExternalOverridePolicy = "respect" | "ignore" | "extend";

export interface PresenceAreaConfig {
    topic: string;                          // Room identifier (e.g., "guest_bathroom")
    sensors: string[];                      // Entity IDs that detect presence
    entities: PresenceTrackedEntity[];      // What to control
    coolDown: number;                       // Base cooldown in seconds (default 600)
    enabled: boolean;
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
