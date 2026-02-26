/**
 * Clear All Cooldowns API - POST /endpoint/presence/clear-all-cooldowns
 *
 * Node wiring:
 *   [http-in: POST /presence/clear-all-cooldowns] → [function: this] → [http-response]
 *
 * Resets active cooldowns for ALL presence areas:
 *   - Clears delay and coolDownEndTime on each area
 *   - Transitions pending_off → off
 *   - Updates lastOff timestamp
 */

import type { PresenceRegistry } from "../types";

const REGISTRY_KEY = "presenceRegistry";

// @ts-ignore - Node-RED global
const message = msg;

// @ts-ignore
const registry: PresenceRegistry | undefined = global.get(REGISTRY_KEY);

if (!registry) {
    message.payload = { error: "Presence registry not initialized" };
    message.statusCode = 500;
} else {
    const forceReset = message.req?.query?.reset === "true" ||
        (message.req?.body?.reset === true);
    const cleared: string[] = [];

    for (const area of Object.values(registry.areas)) {
        if (!area.enabled) continue;

        const flowInfoKey = `presenceFlowInfo.${area.topic}`;
        // @ts-ignore
        const flowInfo = global.get(flowInfoKey);
        if (!flowInfo) continue;

        const shouldClear = forceReset ||
            flowInfo.state === "pending_off" ||
            flowInfo.coolDownEndTime;

        if (shouldClear) {
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

            if (forceReset) {
                const presenceStatesKey = `presenceStates.${area.topic}`;
                // @ts-ignore
                global.set(presenceStatesKey, {});
            }

            cleared.push(area.topic);
        }
    }

    message.payload = {
        success: true,
        cleared,
        count: cleared.length
    };
    message.statusCode = 200;

    // Attach logging metadata for downstream InfluxDB node
    message.influxLog = {
        measurement: "api_events",
        fields: {
            operation: "clear_all_cooldowns",
            cleared_areas: cleared.join(","),
            cleared_count: cleared.length,
            timestamp_ms: Date.now()
        },
        tags: { flow: "api", event_type: "presence_clear_all_cooldowns" }
    };
}

// @ts-ignore
msg = message;
