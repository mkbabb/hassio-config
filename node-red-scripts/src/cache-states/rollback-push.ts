/**
 * Rollback Push - receives pre-scene state from scene_rollback component
 *
 * Node wiring:
 *   [http-in: POST /endpoint/scene-cache/] → [function: this] → [http-response: 200]
 *
 * Stores the captured pre-scene entity states so they can be restored later.
 * Uses global context for storage (single rollback entry + ring buffer log).
 */

import { createServiceCall } from "./utils";
import { filterBlacklistedEntity } from "../utils/utils";

// @ts-ignore - Node-RED global
const message = msg;

const ROLLBACK_STACK_KEY = "rollbackStack";
const ROLLBACK_LOG_KEY = "rollbackLog";
const MAX_LOG_ENTRIES = 20;

interface RollbackEntry {
    sceneIds: string[];
    serviceCalls: Hass.Service[];
    entityCount: number;
    timestamp: number;
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

    // Filter blacklisted entities and convert to service calls
    const serviceCalls: Hass.Service[] = entities
        .filter((entity) => filterBlacklistedEntity(entity))
        .map(createServiceCall)
        .filter((x): x is Hass.Service => x !== undefined);

    const entry: RollbackEntry = {
        sceneIds,
        serviceCalls,
        entityCount: serviceCalls.length,
        timestamp: Date.now(),
    };

    // Store single rollback entry (LIFO depth=1)
    // @ts-ignore - Node-RED global context
    global.set(ROLLBACK_STACK_KEY, entry);

    // Append to ring buffer log
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
        timestamp: entry.timestamp,
    };

    message.payload = {
        success: true,
        entityCount: serviceCalls.length,
    };
    message.statusCode = 200;

    // @ts-ignore
    msg = message;
}
