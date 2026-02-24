/**
 * Schedule API Validation
 * Schema validation for schedule create/update operations
 */

import type { Schedule, ScheduleCondition } from "../types";

export interface ValidationResult {
    valid: boolean;
    errors: string[];
}

const NAME_PATTERN = /^[a-z][a-z0-9_]*$/;
const TIME_PATTERN = /^\d{2}:\d{2}$/;

/**
 * Validate a time value — either "HH:MM" string or entity reference
 */
function validateTime(time: any, fieldName: string, errors: string[]): void {
    if (time == null) {
        errors.push(`${fieldName} is required`);
        return;
    }
    if (typeof time === "string") {
        if (!TIME_PATTERN.test(time)) {
            errors.push(`${fieldName} must be "HH:MM" format, got "${time}"`);
        }
    } else if (typeof time === "object" && time.entity_id) {
        if (typeof time.entity_id !== "string") {
            errors.push(`${fieldName}.entity_id must be a string`);
        } else if (!time.entity_id.startsWith("input_datetime.") && !time.entity_id.startsWith("sensor.")) {
            errors.push(`${fieldName}.entity_id must start with "input_datetime." or "sensor."`);
        }
    } else {
        errors.push(`${fieldName} must be a "HH:MM" string or { entity_id: "..." }`);
    }
}

/**
 * Validate conditions array
 */
function validateConditions(conditions: any[], errors: string[]): void {
    for (let i = 0; i < conditions.length; i++) {
        const c = conditions[i];
        if (!c.type || !["presence", "state"].includes(c.type)) {
            errors.push(`conditions[${i}].type must be "presence" or "state"`);
        }
        if (c.value == null) {
            errors.push(`conditions[${i}].value is required`);
        }
        if (c.type === "state" && !c.entity_id) {
            errors.push(`conditions[${i}].entity_id is required for state conditions`);
        }
    }
}

/**
 * Validate entities array
 */
function validateEntities(entities: any[], errors: string[]): void {
    if (!Array.isArray(entities)) {
        errors.push("entities must be an array");
        return;
    }
    for (let i = 0; i < entities.length; i++) {
        const e = entities[i];
        if (typeof e === "string") continue; // string entity IDs and "regex:..." patterns are valid
        if (typeof e === "object" && e.entity_id) continue; // EntityConfig objects are valid
        errors.push(`entities[${i}] must be a string (entity ID or "regex:...") or an EntityConfig object`);
    }
}

/**
 * Validate a schedule for creation
 */
export function validateCreateSchedule(
    body: any,
    existingNames: string[]
): ValidationResult {
    const errors: string[] = [];

    // Name
    if (!body.name) {
        errors.push("name is required");
    } else if (!NAME_PATTERN.test(body.name)) {
        errors.push(`name must match ${NAME_PATTERN} (lowercase, start with letter)`);
    } else if (existingNames.includes(body.name)) {
        errors.push(`schedule "${body.name}" already exists`);
    }

    // Start time
    validateTime(body.start, "start", errors);

    // End time (optional for trigger schedules)
    if (body.end != null) {
        validateTime(body.end, "end", errors);
    }

    // Precedence
    if (body.precedence == null) {
        errors.push("precedence is required");
    } else if (typeof body.precedence !== "number" || body.precedence < 0 || body.precedence > 1000) {
        errors.push("precedence must be a number between 0 and 1000");
    }

    // Type
    if (body.type && !["continuous", "trigger"].includes(body.type)) {
        errors.push('type must be "continuous" or "trigger"');
    }

    // Entities
    if (body.entities) {
        validateEntities(body.entities, errors);
    }

    // Conditions
    if (body.conditions) {
        if (!Array.isArray(body.conditions)) {
            errors.push("conditions must be an array");
        } else {
            validateConditions(body.conditions, errors);
        }
    }

    // durationModifier
    if (body.durationModifier != null) {
        if (typeof body.durationModifier !== "number" || body.durationModifier <= 0 || body.durationModifier >= 1) {
            errors.push("durationModifier must be a number between 0 and 1 (exclusive)");
        }
    }

    return { valid: errors.length === 0, errors };
}

/**
 * Validate a schedule update
 * Static schedules: only enabled, precedence, conditions are mutable
 * Dynamic schedules: all fields are mutable
 */
export function validateUpdateSchedule(
    body: any,
    isStatic: boolean
): ValidationResult {
    const errors: string[] = [];

    if (isStatic) {
        const allowedKeys = ["enabled", "precedence", "conditions", "clearStaticOnTransition"];
        const extraKeys = Object.keys(body).filter(k => !allowedKeys.includes(k));
        if (extraKeys.length > 0) {
            errors.push(`static schedules only allow updating: ${allowedKeys.join(", ")}. Got extra keys: ${extraKeys.join(", ")}`);
        }
    }

    // Validate individual fields if present
    if (body.precedence != null) {
        if (typeof body.precedence !== "number" || body.precedence < 0 || body.precedence > 1000) {
            errors.push("precedence must be a number between 0 and 1000");
        }
    }

    if (body.enabled != null && typeof body.enabled !== "boolean") {
        errors.push("enabled must be a boolean");
    }

    if (body.clearStaticOnTransition != null && typeof body.clearStaticOnTransition !== "boolean") {
        errors.push("clearStaticOnTransition must be a boolean");
    }

    if (body.start != null) validateTime(body.start, "start", errors);
    if (body.end != null) validateTime(body.end, "end", errors);

    if (body.type && !["continuous", "trigger"].includes(body.type)) {
        errors.push('type must be "continuous" or "trigger"');
    }

    if (body.entities) validateEntities(body.entities, errors);

    if (body.conditions) {
        if (!Array.isArray(body.conditions)) {
            errors.push("conditions must be an array");
        } else {
            validateConditions(body.conditions, errors);
        }
    }

    return { valid: errors.length === 0, errors };
}
