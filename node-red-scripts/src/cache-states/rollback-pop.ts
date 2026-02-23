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
 * Reads the stored rollback entry, converts to grouped actions, outputs them.
 * Clears the rollback stack after pop.
 */

import { serviceToActionCall, groupActions } from "../utils/service-calls";

// @ts-ignore - Node-RED global
const message = msg;

const ROLLBACK_STACK_KEY = "rollbackStack";

interface RollbackEntry {
    sceneIds: string[];
    serviceCalls: Hass.Service[];
    entityCount: number;
    timestamp: number;
}

// @ts-ignore - Node-RED global context
const entry: RollbackEntry | null = global.get(ROLLBACK_STACK_KEY);

if (!entry || !entry.serviceCalls || entry.serviceCalls.length === 0) {
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
    const ageMs = Date.now() - entry.timestamp;

    // Convert stored service calls to action format and group
    const actions = groupActions(entry.serviceCalls.map(serviceToActionCall));

    message.payload = actions;

    message.debug = {
        operation: "pop",
        entityCount: entry.entityCount,
        sceneIds: entry.sceneIds.join(","),
        ageMs,
        timestamp: Date.now(),
    };

    // Clear the rollback stack
    // @ts-ignore - Node-RED global context
    global.set(ROLLBACK_STACK_KEY, null);
}

// @ts-ignore
msg = message;
