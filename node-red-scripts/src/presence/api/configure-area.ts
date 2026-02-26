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

    // Sensors required only for new areas (existing areas preserve current sensors)
    const existingArea = (() => {
        if (!body.topic) return undefined;
        // @ts-ignore
        const reg: PresenceRegistry = global.get(REGISTRY_KEY);
        return reg?.areas?.[body.topic];
    })();

    if (body.sensors != null) {
        if (!Array.isArray(body.sensors) || body.sensors.length === 0) {
            errors.push("sensors must be a non-empty array when provided");
        } else {
            // Validate each sensor entry (string or {entity_id, triggerMode})
            for (const s of body.sensors) {
                if (typeof s === "string") continue;
                if (typeof s === "object" && s !== null && typeof s.entity_id === "string") {
                    if (s.triggerMode && !["level", "edge"].includes(s.triggerMode)) {
                        errors.push(`sensor ${s.entity_id}: triggerMode must be "level" or "edge"`);
                    }
                } else {
                    errors.push("each sensor must be a string or {entity_id: string, triggerMode?: 'level'|'edge'}");
                }
            }
        }
    } else if (!existingArea) {
        errors.push("sensors is required for new areas");
    }

    if (body.entities && !Array.isArray(body.entities)) {
        errors.push("entities must be an array");
    }

    if (body.externalOverridePolicy && !["respect", "ignore", "extend"].includes(body.externalOverridePolicy)) {
        errors.push('externalOverridePolicy must be "respect", "ignore", or "extend"');
    }

    if (body.externalOverrideGracePeriod != null && (typeof body.externalOverrideGracePeriod !== "number" || body.externalOverrideGracePeriod < 0)) {
        errors.push("externalOverrideGracePeriod must be a non-negative number (seconds)");
    }

    if (body.coolDown != null && (typeof body.coolDown !== "number" || body.coolDown < 0)) {
        errors.push("coolDown must be a non-negative number (seconds)");
    }

    if (body.enabled != null && typeof body.enabled !== "boolean") {
        errors.push("enabled must be a boolean");
    }

    if (body.conditions != null) {
        if (!Array.isArray(body.conditions)) {
            errors.push("conditions must be an array");
        } else {
            for (const c of body.conditions) {
                if (typeof c !== "object" || !c || typeof c.entity_id !== "string") {
                    errors.push("each condition must have an entity_id string");
                } else if (c.state == null) {
                    errors.push(`condition for ${c.entity_id}: state is required`);
                } else if (typeof c.state !== "string" && !Array.isArray(c.state)) {
                    errors.push(`condition for ${c.entity_id}: state must be a string or array of strings`);
                }
            }
        }
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

        // For existing areas, preserve fields not provided in the request
        const sensors = body.sensors ?? existing?.sensors ?? [];
        const entities = body.entities
            ? body.entities.map((e: any) => typeof e === "string" ? { entity_id: e } : e)
            : existing?.entities ?? [];

        const conditions = body.conditions != null
            ? body.conditions
            : existing?.conditions;

        const area: PresenceAreaConfig = {
            topic: body.topic,
            sensors,
            entities,
            coolDown: body.coolDown ?? existing?.coolDown ?? 600,
            enabled: body.enabled ?? existing?.enabled ?? true,
            conditions,
            externalOverridePolicy: body.externalOverridePolicy ?? existing?.externalOverridePolicy,
            externalOverrideGracePeriod: body.externalOverrideGracePeriod ?? existing?.externalOverrideGracePeriod,
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
                enabled: area.enabled,
                conditions: area.conditions,
                externalOverridePolicy: area.externalOverridePolicy,
                externalOverrideGracePeriod: area.externalOverrideGracePeriod
            }
        };
        message.statusCode = existing ? 200 : 201;

        // Attach logging metadata for downstream InfluxDB node
        message.influxLog = {
            measurement: "api_events",
            fields: {
                operation: existing ? "presence_update" : "presence_create",
                topic: body.topic,
                changes: JSON.stringify(body).substring(0, 1000),
                timestamp_ms: Date.now()
            },
            tags: { flow: "api", event_type: existing ? "presence_update" : "presence_create" }
        };
    }

    // @ts-ignore
    msg = message;
}
