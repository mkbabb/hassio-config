/**
 * Configure Presence Area API - POST /endpoint/presence/
 *
 * Node wiring:
 *   [http-in: POST /endpoint/presence/] → [function: this] → [http-response]
 *
 * Create or update a presence area configuration.
 */

import type { PresenceAreaConfig, PresenceRegistry } from "../types";
import { clearNamespace, addToBlacklist } from "../../utils/static-states";
import { filterBlacklistedEntity } from "../../utils/utils";

const PRESENCE_NAMESPACE = "presence";
const REGISTRY_KEY = "presenceRegistry";

// @ts-ignore - Node-RED global
const message = msg;

const body = message.req?.body || message.payload;

if (!body || typeof body !== "object") {
    message.payload = { error: "Request body is required" };
    message.statusCode = 400;
    // @ts-ignore
    msg = message;
} else {
    // Validate required fields
    const errors: string[] = [];

    if (!body.topic || typeof body.topic !== "string") {
        errors.push("topic is required and must be a string");
    } else if (!/^[a-z][a-z0-9_]*$/.test(body.topic)) {
        errors.push("topic must match ^[a-z][a-z0-9_]*$");
    }

    if (!body.sensors || !Array.isArray(body.sensors) || body.sensors.length === 0) {
        errors.push("sensors must be a non-empty array of entity IDs");
    }

    if (body.entities && !Array.isArray(body.entities)) {
        errors.push("entities must be an array");
    }

    if (body.coolDown != null && (typeof body.coolDown !== "number" || body.coolDown < 0)) {
        errors.push("coolDown must be a non-negative number (seconds)");
    }

    if (errors.length > 0) {
        message.payload = { error: "Validation failed", details: errors };
        message.statusCode = 400;
    } else {
        // @ts-ignore
        const registry: PresenceRegistry = global.get(REGISTRY_KEY) ?? {
            version: 1,
            areas: {},
            lastSeeded: null
        };

        const now = new Date().toISOString();
        const existing = registry.areas[body.topic];

        const area: PresenceAreaConfig = {
            topic: body.topic,
            sensors: body.sensors,
            entities: (body.entities || []).map((e: any) =>
                typeof e === "string" ? { entity_id: e } : e
            ),
            coolDown: body.coolDown ?? 600,
            enabled: body.enabled !== false,
            createdAt: existing?.createdAt || now,
            updatedAt: now
        };

        registry.areas[body.topic] = area;
        // @ts-ignore
        global.set(REGISTRY_KEY, registry);

        // Re-register all presence entities in the blacklist
        clearNamespace(PRESENCE_NAMESPACE);
        for (const a of Object.values(registry.areas)) {
            if (!a.enabled) continue;
            for (const tracked of a.entities) {
                if (filterBlacklistedEntity(tracked.entity_id)) {
                    addToBlacklist(tracked.entity_id, PRESENCE_NAMESPACE);
                }
            }
        }

        message.payload = {
            success: true,
            created: !existing,
            area: {
                topic: area.topic,
                sensors: area.sensors,
                entities: area.entities,
                coolDown: area.coolDown,
                enabled: area.enabled
            }
        };
        message.statusCode = existing ? 200 : 201;
    }

    // @ts-ignore
    msg = message;
}
