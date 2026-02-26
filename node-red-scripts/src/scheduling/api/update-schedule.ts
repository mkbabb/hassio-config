/**
 * Update Schedule API - PUT /endpoint/schedules/:name
 *
 * Node wiring:
 *   [http-in: PUT /endpoint/schedules/:name] → [function: this] → [http-response]
 *
 * Static schedules: only enabled, precedence, conditions are mutable.
 * Dynamic schedules: all fields are mutable.
 */

import { getRegistry, saveRegistry } from "./registry";
import { validateUpdateSchedule } from "./validation";

// @ts-ignore - Node-RED global
const message = msg;

const name = message.req?.params?.name;
const body = message.req?.body || message.payload;

if (!name) {
    message.payload = { error: "Schedule name is required" };
    message.statusCode = 400;
    // @ts-ignore
    msg = message;
} else if (!body || typeof body !== "object") {
    message.payload = { error: "Request body is required" };
    message.statusCode = 400;
    // @ts-ignore
    msg = message;
} else {
    const registry = getRegistry();
    const schedule = registry.schedules[name];

    if (!schedule) {
        message.payload = { error: `Schedule "${name}" not found` };
        message.statusCode = 404;
    } else {
        const isStatic = schedule.source === "static";
        const validation = validateUpdateSchedule(body, isStatic);

        if (!validation.valid) {
            message.payload = { error: "Validation failed", details: validation.errors };
            message.statusCode = 400;
        } else {
            const now = new Date().toISOString();

            if (isStatic) {
                // Static schedules: only allow enabled, precedence, conditions, clearStaticOnTransition, durationModifier
                if (body.enabled != null) schedule.enabled = body.enabled;
                if (body.precedence != null) schedule.precedence = body.precedence;
                if (body.conditions != null) schedule.conditions = body.conditions;
                if (body.clearStaticOnTransition != null) schedule.clearStaticOnTransition = body.clearStaticOnTransition;
                if (body.durationModifier !== undefined) schedule.durationModifier = body.durationModifier;
            } else {
                // Dynamic schedules: allow all fields
                if (body.start != null) schedule.start = body.start;
                if (body.end !== undefined) schedule.end = body.end;
                if (body.precedence != null) schedule.precedence = body.precedence;
                if (body.type != null) schedule.type = body.type;
                if (body.entities !== undefined) schedule.entities = body.entities;
                if (body.tags !== undefined) schedule.tags = body.tags;
                if (body.conditions !== undefined) schedule.conditions = body.conditions;
                if (body.durationModifier !== undefined) schedule.durationModifier = body.durationModifier;
                if (body.interpolation !== undefined) schedule.interpolation = body.interpolation;
                if (body.defaultStates !== undefined) schedule.defaultStates = body.defaultStates;
                if (body.enabled != null) schedule.enabled = body.enabled;
                if (body.clearStaticOnTransition != null) schedule.clearStaticOnTransition = body.clearStaticOnTransition;
                if (body.helperEntities !== undefined) schedule.helperEntities = body.helperEntities;
            }

            schedule.updatedAt = now;
            registry.schedules[name] = schedule;
            saveRegistry(registry);

            message.payload = {
                success: true,
                schedule: {
                    name: schedule.name,
                    source: schedule.source,
                    enabled: schedule.enabled,
                    precedence: schedule.precedence,
                    updatedAt: schedule.updatedAt
                }
            };
            message.statusCode = 200;

            // Attach logging metadata for downstream InfluxDB node
            message.influxLog = {
                measurement: "api_events",
                fields: {
                    operation: "schedule_update",
                    schedule_name: name,
                    source: isStatic ? "static" : "dynamic",
                    changes: JSON.stringify(body).substring(0, 1000),
                    timestamp_ms: Date.now()
                },
                tags: { flow: "api", event_type: "schedule_update" }
            };
        }
    }

    // @ts-ignore
    msg = message;
}
