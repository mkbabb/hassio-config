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
 *   [inject: once on startup] → [function: this (outputs: 2)]
 *     Output 1 → [schedule engine]
 *     Output 2 → [split] → [presence publisher] → [ha-api: POST /api/states/]
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

// Build summary for debug output
const summary = {
    scheduleCount: scheduleRegistry ? Object.keys(scheduleRegistry.schedules).length : 0,
    presenceAreaCount: presenceRegistry ? Object.keys(presenceRegistry.areas).length : 0,
    cachedStateCount: Array.isArray(cachedStates) ? cachedStates.length : 0,
    rollbackStackDepth: Array.isArray(rollbackStack) ? rollbackStack.length : 0,
    timestamp: new Date().toISOString()
};

// Log startup info
// @ts-ignore
node.warn(`Startup republish: ${summary.scheduleCount} schedules, ${summary.presenceAreaCount} presence areas, ${summary.cachedStateCount} cached states, ${summary.rollbackStackDepth} rollback entries`);

// Output 1: Schedule engine trigger (existing behavior)
const scheduleMsg = {
    ...message,
    forcePublish: true,
    startup: true,
    debug: {
        operation: "startup-republish",
        ...summary
    }
};

// Output 2: Presence republish messages (one per area)
const presenceMessages: any[] = [];
if (presenceRegistry) {
    for (const [topic, area] of Object.entries(presenceRegistry.areas)) {
        if (!area.enabled) continue;
        // @ts-ignore
        const flowInfo = global.get(`presenceFlowInfo.${topic}`) || { state: "off", delay: 0 };
        // @ts-ignore
        const presenceStates = global.get(`presenceStates.${topic}`) || {};
        presenceMessages.push({
            topic,
            presenceState: flowInfo.state || "off",
            flowInfo,
            presenceStates,
            forcePublish: true,
            startup: true,
            debug: {
                operation: "startup-republish",
                trigger_sensor: "startup"
            }
        });
    }
}

// @ts-ignore
node.warn(`Startup republish: queued ${presenceMessages.length} presence area republish messages`);

// Multi-output: [scheduleMsg, presenceMessages]
// Output 2 is an array of messages — Node-RED sends each as a separate message,
// so no split node is needed. Each message has top-level topic, presenceState, etc.
// @ts-ignore
msg = [scheduleMsg, presenceMessages.length > 0 ? presenceMessages : null];
