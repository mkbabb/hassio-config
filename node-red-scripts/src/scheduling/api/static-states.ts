/**
 * Static States API - GET/POST /endpoint/static-states/
 *
 * Node wiring:
 *   [http-in: GET /static-states/] → [function: this] → [http-response]
 *   [http-in: POST /static-states/clear] → [function: this] → [http-response]
 *
 * GET: Returns current static states, blacklists, and external modifications
 * POST (clear): Clears external modifications (optionally filtered by schedule)
 *
 * Input: msg.req.method, msg.req.body
 * Output: msg.payload (JSON), msg.statusCode
 */

import {
    getExternalModifications,
    getExternalModificationSummary,
    clearExternalModificationsForSchedule,
    clearAllExternalModifications,
    clearAllStaticStates,
    clearNamespace
} from "../../utils/static-states";

// @ts-ignore - Node-RED global
const message = msg;

const method = message.req?.method || "GET";
const body = message.req?.body || {};

// Route: path after /static-states/
const url = message.req?.url || "";
const pathMatch = url.match(/\/static-states\/?(.*)$/);
const subPath = pathMatch?.[1]?.replace(/^\//, "") || "";

if (method === "GET") {
    // GET /static-states/ — return full overview
    const registry = getExternalModifications();
    const summary = getExternalModificationSummary();

    // @ts-ignore
    const staticStates = global.get("staticStates") || {};
    // @ts-ignore
    const staticBlacklist = global.get("staticBlacklist") || {};

    message.payload = {
        externalModifications: {
            count: summary.count,
            entities: summary.entities,
            schedules: summary.schedules,
            oldestAge: summary.oldestMs ? Math.round((Date.now() - summary.oldestMs) / 60000) + " minutes" : null,
            details: registry.modifications,
            lastCleared: registry.lastCleared ? new Date(registry.lastCleared).toISOString() : null
        },
        staticStates,
        staticBlacklist
    };
    message.statusCode = 200;

} else if (method === "POST" && subPath === "clear") {
    // POST /static-states/clear — clear modifications
    const { schedule, namespace, all } = body;

    let cleared = 0;
    let description = "";

    if (all === true) {
        // Clear everything (except presence namespace)
        cleared += clearAllExternalModifications();
        cleared += clearAllStaticStates(["presence"]);
        description = "Cleared all external modifications and static states (preserved presence namespace)";
    } else if (schedule) {
        // Clear for a specific schedule
        cleared = clearExternalModificationsForSchedule(schedule);
        description = `Cleared external modifications for schedule: ${schedule}`;
    } else if (namespace) {
        // Clear a specific namespace
        clearNamespace(namespace);
        description = `Cleared namespace: ${namespace}`;
        cleared = 1; // Namespace cleared (count not tracked per-entity here)
    } else {
        // Default: clear all external modifications only
        cleared = clearAllExternalModifications();
        description = "Cleared all external modifications";
    }

    message.payload = {
        success: true,
        cleared,
        description
    };
    message.statusCode = 200;

} else {
    message.payload = { error: "Method not allowed. Use GET or POST /static-states/clear" };
    message.statusCode = 405;
}

// @ts-ignore
msg = message;
