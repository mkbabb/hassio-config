/**
 * Startup Republish
 * Runs once on deploy (via inject node with once: true).
 * Clears ephemeral dedup caches and triggers a full sensor republish
 * from persistent global context registries.
 *
 * This ensures HA sensors reappear within seconds of Node-RED restart,
 * and within ~30s of HA restart (on next evaluation cycle).
 *
 * Node wiring:
 *   [inject: once on startup] → [function: this] → [schedule engine] + [presence publisher] + [cache publisher]
 */

import type { ScheduleRegistry } from "../scheduling/types";
import type { PresenceRegistry } from "../presence/types";

// @ts-ignore - Node-RED global
const message = msg;

// Read persistent registries
// @ts-ignore
const scheduleRegistry: ScheduleRegistry | undefined = global.get("scheduleRegistry");
// @ts-ignore
const presenceRegistry: PresenceRegistry | undefined = global.get("presenceRegistry");
// @ts-ignore
const cachedStates: any[] | undefined = global.get("cachedStates");
// @ts-ignore
const rollbackStack: any[] | undefined = global.get("rollbackStack");

// Clear ephemeral dedup caches to force full republish on next evaluation
// @ts-ignore
flow.set("publishedScheduleStates", null, "memory");
// @ts-ignore
flow.set("publishedPresenceStates", null, "memory");
// @ts-ignore
flow.set("publishedCacheStates", null, "memory");

// Signal downstream nodes to force a full publish cycle
message.forcePublish = true;
message.startup = true;

// Build summary for debug output
const summary = {
    scheduleCount: scheduleRegistry ? Object.keys(scheduleRegistry.schedules).length : 0,
    presenceAreaCount: presenceRegistry ? Object.keys(presenceRegistry.areas).length : 0,
    cachedStateCount: Array.isArray(cachedStates) ? cachedStates.length : 0,
    rollbackStackDepth: Array.isArray(rollbackStack) ? rollbackStack.length : 0,
    timestamp: new Date().toISOString()
};

message.debug = {
    operation: "startup-republish",
    ...summary
};

// Log startup info
// @ts-ignore
node.warn(`Startup republish: ${summary.scheduleCount} schedules, ${summary.presenceAreaCount} presence areas, ${summary.cachedStateCount} cached states, ${summary.rollbackStackDepth} rollback entries`);

// @ts-ignore
msg = message;
