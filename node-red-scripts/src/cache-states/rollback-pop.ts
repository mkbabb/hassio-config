/**
 * Rollback Pop - restores pre-scene state when input_boolean.scene_rollback turns on
 *
 * Node wiring:
 *   [state-changed: input_boolean.scene_rollback → "on"]
 *     → [function: this]
 *     → [switch: msg.payload != null]
 *       → [split] → [api-call-service] → [join]
 *       → [influxdb out]
 *     → [api-call-service: input_boolean.turn_off scene_rollback]
 *
 * Pops from N-deep LIFO stack. Before restoring, captures current state
 * as an auto-save entry so the user can undo the undo.
 */

import { serviceToActionCall, groupActions } from "../utils/service-calls";
import { createServiceCall } from "./utils";
import { getAllEntities, getEntity } from "../utils/entities";
import { filterBlacklistedEntity } from "../utils/utils";
import { shouldFilterEntity } from "../utils/static-states";
import { formatDuration } from "../utils/datetime";

// @ts-ignore - Node-RED global
const message = msg;

const ROLLBACK_STACK_KEY = "rollbackStack";
const MAX_STACK_DEPTH = 10;

interface RollbackEntry {
    sceneIds: string[];
    serviceCalls: Hass.Service[];
    entityCount: number;
    timestamp: number;
    label: string;
}

// @ts-ignore - Node-RED global context
const stack: RollbackEntry[] = global.get(ROLLBACK_STACK_KEY) || [];

if (stack.length === 0) {
    // Nothing to roll back
    message.payload = null;

    message.debug = {
        operation: "pop",
        entityCount: 0,
        sceneIds: "",
        ageMs: 0,
        timestamp: Date.now(),
    };
} else {
    // Determine which entry to pop (default: most recent)
    const targetIndex = message.rollbackIndex != null
        ? Math.min(Math.max(0, message.rollbackIndex), stack.length - 1)
        : stack.length - 1;

    const targetEntry = stack[targetIndex];
    const ageMs = Date.now() - targetEntry.timestamp;

    // Auto-save: capture current state of entities that will be restored
    const targetEntityIds = new Set(
        targetEntry.serviceCalls.map(sc => sc.data?.entity_id).filter(Boolean)
    );

    const allEntities = getAllEntities();
    const autoSaveCalls: Hass.Service[] = [];

    if (allEntities) {
        for (const entityId of targetEntityIds) {
            const entity = allEntities[entityId];
            if (entity && filterBlacklistedEntity(entity) &&
                !shouldFilterEntity(entityId, { checkBlacklist: true, checkStaticState: false, namespace: "presence" })) {
                const sc = createServiceCall(entity);
                if (sc) autoSaveCalls.push(sc);
            }
        }
    }

    // Remove the target entry from stack
    stack.splice(targetIndex, 1);

    // Push auto-save onto stack (so user can undo the undo)
    if (autoSaveCalls.length > 0) {
        const autoSaveEntry: RollbackEntry = {
            sceneIds: ["auto-save"],
            serviceCalls: autoSaveCalls,
            entityCount: autoSaveCalls.length,
            timestamp: Date.now(),
            label: `Auto-save before restoring "${targetEntry.label}"`
        };
        stack.push(autoSaveEntry);
        if (stack.length > MAX_STACK_DEPTH) {
            stack.shift();
        }
    }

    // @ts-ignore
    global.set(ROLLBACK_STACK_KEY, stack);

    // Convert stored service calls to action format and group
    const actions = groupActions(targetEntry.serviceCalls.map(serviceToActionCall));

    message.payload = actions;

    message.debug = {
        operation: "pop",
        entityCount: targetEntry.entityCount,
        sceneIds: targetEntry.sceneIds.join(","),
        label: targetEntry.label,
        ageMs,
        autoSaveCount: autoSaveCalls.length,
        remainingStackDepth: stack.length,
        timestamp: Date.now(),
    };
}

// Preserve last_scene attributes from existing sensor state
const existingSensor = getEntity("sensor.scene_rollback_status");
const existingAttrs = existingSensor?.attributes || {};

// Publish rollback status sensor to HA
const updatedStack: RollbackEntry[] = stack;
message.rollbackSensorUpdate = {
    entity_id: "sensor.scene_rollback_status",
    state: updatedStack.length > 0 ? "available" : "empty",
    attributes: {
        friendly_name: "Scene Rollback Status",
        icon: "mdi:undo-variant",
        stack_depth: updatedStack.length,
        max_depth: MAX_STACK_DEPTH,
        last_scene_activated: existingAttrs["last_scene_activated"] || null,
        last_scene_time: existingAttrs["last_scene_time"] || null,
        entries: updatedStack.map((e, i) => ({
            index: i,
            label: e.label,
            scene_ids: e.sceneIds.join(", "),
            entity_count: e.entityCount,
            age_minutes: Math.round((Date.now() - e.timestamp) / 60000),
            age_formatted: formatDuration((Date.now() - e.timestamp) / 60000),
            timestamp: new Date(e.timestamp).toISOString()
        }))
    }
};

// @ts-ignore
msg = message;
