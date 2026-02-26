/**
 * Clear Cooldown API - POST /endpoint/presence/:topic/clear-cooldown
 *
 * Node wiring:
 *   [http-in: POST /presence/:topic/clear-cooldown] → [function: this] → [http-response]
 *
 * Resets active cooldown for a specific presence area:
 *   - Clears delay and coolDownEndTime
 *   - Transitions pending_off → off
 *   - Updates lastOff timestamp
 */

import type { PresenceRegistry } from "../types";

const REGISTRY_KEY = "presenceRegistry";

// @ts-ignore - Node-RED global
const message = msg;

const topic = message.req?.params?.topic;

if (!topic) {
    message.payload = { error: "Topic parameter is required" };
    message.statusCode = 400;
    // @ts-ignore
    msg = message;
} else {
    // @ts-ignore
    const registry: PresenceRegistry | undefined = global.get(REGISTRY_KEY);

    if (!registry || !registry.areas[topic]) {
        message.payload = { error: `Presence area "${topic}" not found` };
        message.statusCode = 404;
    } else {
        const flowInfoKey = `presenceFlowInfo.${topic}`;
        // @ts-ignore
        const flowInfo = global.get(flowInfoKey) || {};

        const previousState = flowInfo.state || "unknown";
        const previousDelay = flowInfo.delay || 0;
        const forceReset = message.req?.query?.reset === "true";

        flowInfo.delay = 0;
        flowInfo.coolDownEndTime = null;

        if (forceReset || flowInfo.state === "pending_off") {
            flowInfo.state = "off";
            flowInfo.prevState = "off";
            flowInfo.prevPrevState = "off";
            flowInfo.lastOff = Date.now();
            flowInfo.lastOn = null;
        }

        // @ts-ignore
        global.set(flowInfoKey, flowInfo);

        // If force reset, also clear stale sensor states
        if (forceReset) {
            const presenceStatesKey = `presenceStates.${topic}`;
            // @ts-ignore
            global.set(presenceStatesKey, {});
        }

        message.payload = {
            success: true,
            topic,
            previousState,
            newState: flowInfo.state,
            clearedCooldownMs: previousDelay
        };
        message.statusCode = 200;

        // Attach logging metadata for downstream InfluxDB node
        message.influxLog = {
            measurement: "api_events",
            fields: {
                operation: "clear_cooldown",
                topic,
                previous_state: previousState,
                new_state: flowInfo.state || "unknown",
                cleared_cooldown_ms: previousDelay,
                timestamp_ms: Date.now()
            },
            tags: { flow: "api", event_type: "presence_clear_cooldown" }
        };
    }

    // @ts-ignore
    msg = message;
}
