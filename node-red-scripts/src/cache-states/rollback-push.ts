/**
 * Rollback Push - receives pre-scene state from scene_rollback component
 *
 * Node wiring:
 *   [http-in: POST /endpoint/scene-cache/] → [function: this] → [http-response: 200]
 *
 * Stores the captured pre-scene entity states so they can be restored later.
 * Uses global context for storage (N-deep LIFO stack, max 10 + ring buffer log).
 */

import { createServiceCall } from "./utils";
import { filterBlacklistedEntity } from "../utils/utils";
import { shouldFilterEntity } from "../utils/static-states";

// @ts-ignore - Node-RED global
const message = msg;

const ROLLBACK_STACK_KEY = "rollbackStack";
const ROLLBACK_LOG_KEY = "rollbackLog";
const MAX_STACK_DEPTH = 10;
const MAX_LOG_ENTRIES = 20;

interface RollbackEntry {
    sceneIds: string[];
    serviceCalls: Hass.Service[];
    entityCount: number;
    timestamp: number;
    label: string;
}

// Payload from scene_rollback component
const payload = message.payload || message.req?.body;

if (!payload || !payload.entities || !Array.isArray(payload.entities)) {
    message.payload = { success: false, error: "Invalid payload" };
    message.statusCode = 400;
    // @ts-ignore
    msg = message;
} else {
    const entities: Hass.State[] = payload.entities;
    const sceneIds: string[] = payload.scene_ids || [];

    // Filter blacklisted entities and presence-tracked entities, then convert to service calls
    const serviceCalls: Hass.Service[] = entities
        .filter((entity) => filterBlacklistedEntity(entity))
        .filter((entity) => !shouldFilterEntity(entity.entity_id, { checkBlacklist: true, checkStaticState: false, namespace: "presence" }))
        .map(createServiceCall)
        .filter((x): x is Hass.Service => x !== undefined);

    const label = sceneIds.length > 0
        ? `Before ${sceneIds.map(id => id.replace("scene.", "")).join(", ")}`
        : `Scene capture`;

    const entry: RollbackEntry = {
        sceneIds,
        serviceCalls,
        entityCount: serviceCalls.length,
        timestamp: Date.now(),
        label
    };

    // Push to N-deep LIFO stack
    // @ts-ignore - Node-RED global context
    const stack: RollbackEntry[] = global.get(ROLLBACK_STACK_KEY) || [];
    stack.push(entry);
    if (stack.length > MAX_STACK_DEPTH) {
        stack.shift(); // Drop oldest
    }
    // @ts-ignore
    global.set(ROLLBACK_STACK_KEY, stack);

    // Append to ring buffer log (audit trail)
    // @ts-ignore - Node-RED global context
    const log: RollbackEntry[] = global.get(ROLLBACK_LOG_KEY) || [];
    log.push(entry);
    if (log.length > MAX_LOG_ENTRIES) {
        log.shift();
    }
    // @ts-ignore - Node-RED global context
    global.set(ROLLBACK_LOG_KEY, log);

    // Set debug info for influx logger downstream
    message.debug = {
        operation: "push",
        entityCount: serviceCalls.length,
        sceneIds: sceneIds.join(","),
        stackDepth: stack.length,
        timestamp: entry.timestamp,
    };

    message.payload = {
        success: true,
        entityCount: serviceCalls.length,
        stackDepth: stack.length,
    };
    message.statusCode = 200;

    // Publish rollback status sensor to HA
    message.rollbackSensorUpdate = {
        entity_id: "sensor.scene_rollback_status",
        state: "available",
        attributes: {
            friendly_name: "Scene Rollback Status",
            icon: "mdi:undo-variant",
            stack_depth: stack.length,
            max_depth: MAX_STACK_DEPTH,
            entries: stack.map((e, i) => ({
                index: i,
                label: e.label,
                scene_ids: e.sceneIds.join(", "),
                entity_count: e.entityCount,
                age_minutes: Math.round((Date.now() - e.timestamp) / 60000),
                timestamp: new Date(e.timestamp).toISOString()
            }))
        }
    };

    // @ts-ignore
    msg = message;
}
