/**
 * Create Schedule API - POST /endpoint/schedules/
 *
 * Node wiring:
 *   [http-in: POST /endpoint/schedules/] → [function: this] → [http-response]
 *
 * Creates a new dynamic schedule. Static schedules cannot be created via API.
 */

import { getRegistry, saveRegistry } from "./registry";
import { validateCreateSchedule } from "./validation";
import type { RegistrySchedule } from "../types";

// @ts-ignore - Node-RED global
const message = msg;

const body = message.req?.body || message.payload;

if (!body || typeof body !== "object") {
    message.payload = { error: "Request body is required" };
    message.statusCode = 400;
    // @ts-ignore
    msg = message;
} else {
    const registry = getRegistry();
    const existingNames = Object.keys(registry.schedules);

    const validation = validateCreateSchedule(body, existingNames, registry.schedules);
    if (!validation.valid) {
        message.payload = { error: "Validation failed", details: validation.errors };
        message.statusCode = 400;
    } else {
        const now = new Date().toISOString();

        const schedule: RegistrySchedule = {
            name: body.name,
            start: body.start,
            end: body.end,
            precedence: body.precedence,
            type: body.type || "trigger",
            entities: body.entities,
            tags: body.tags,
            conditions: body.conditions,
            durationModifier: body.durationModifier,
            interpolation: body.interpolation,
            defaultStates: body.defaultStates,
            source: "dynamic",
            enabled: body.enabled !== false,
            createdAt: now,
            updatedAt: now,
            helperEntities: body.helperEntities
        };

        registry.schedules[schedule.name] = schedule;
        saveRegistry(registry);

        message.payload = {
            success: true,
            schedule: {
                name: schedule.name,
                source: schedule.source,
                enabled: schedule.enabled,
                type: schedule.type,
                precedence: schedule.precedence,
                createdAt: schedule.createdAt
            },
            ...(validation.warnings && { warnings: validation.warnings })
        };
        message.statusCode = 201;
    }

    // @ts-ignore
    msg = message;
}
