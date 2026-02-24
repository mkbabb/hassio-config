/**
 * Presence Area Status API - GET /endpoint/presence/:topic/status
 *
 * Node wiring:
 *   [http-in: GET /endpoint/presence/:topic/status] → [function: this] → [http-response]
 *
 * Returns full flow state for one presence area.
 */

import type { PresenceRegistry } from "../types";

// @ts-ignore - Node-RED global
const message = msg;

const topic = message.req?.params?.topic;

if (!topic) {
    message.payload = { error: "Topic parameter is required" };
    message.statusCode = 400;
    // @ts-ignore
    msg = message;
} else {
    const REGISTRY_KEY = "presenceRegistry";

    // @ts-ignore
    const registry: PresenceRegistry | undefined = global.get(REGISTRY_KEY);

    if (!registry) {
        message.payload = { error: "Presence registry not initialized" };
        message.statusCode = 500;
    } else {
        const area = registry.areas[topic];

        if (!area) {
            message.payload = { error: `Area "${topic}" not found` };
            message.statusCode = 404;
        } else {
            // Read all state from global context (migrated from flow for cross-tab access)
            const flowInfoKey = `presenceFlowInfo.${topic}`;
            const presenceStatesKey = `presenceStates.${topic}`;
            const debounceKey = `presenceDebounce.${topic}`;

            // @ts-ignore
            const flowInfo = global.get(flowInfoKey) || {};
            // @ts-ignore
            const presenceStates = global.get(presenceStatesKey) || {};
            // @ts-ignore
            const debounceInfo = global.get(debounceKey) || {};

            const now = Date.now();
            const inCooldown = flowInfo.coolDownEndTime ? now < flowInfo.coolDownEndTime : false;
            const dwellMs = flowInfo.lastOn ? now - flowInfo.lastOn : 0;

            message.payload = {
                topic: area.topic,
                config: {
                    sensors: area.sensors,
                    entities: area.entities,
                    coolDown: area.coolDown,
                    enabled: area.enabled
                },
                state: flowInfo.state || "off",
                flowInfo: {
                    state: flowInfo.state || "off",
                    prevState: flowInfo.prevState || "off",
                    prevPrevState: flowInfo.prevPrevState || "off",
                    lastOn: flowInfo.lastOn || null,
                    lastOff: flowInfo.lastOff || null,
                    delay: flowInfo.delay || 0,
                    coolDownEndTime: flowInfo.coolDownEndTime || null
                },
                runtime: {
                    inCooldown,
                    cooldownRemainingMs: inCooldown ? Math.max(0, flowInfo.coolDownEndTime - now) : 0,
                    dwellMs,
                    dwellMinutes: Math.round(dwellMs / 60000 * 10) / 10
                },
                sensorStates: presenceStates,
                debounce: debounceInfo
            };
            message.statusCode = 200;
        }
    }

    // @ts-ignore
    msg = message;
}
