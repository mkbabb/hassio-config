/**
 * List Presence Areas API - GET /endpoint/presence/
 *
 * Node wiring:
 *   [http-in: GET /endpoint/presence/] → [function: this] → [http-response]
 *
 * Returns all presence area configs with current runtime states.
 */

import type { PresenceRegistry } from "../types";

// @ts-ignore - Node-RED global
const message = msg;

const REGISTRY_KEY = "presenceRegistry";

// @ts-ignore
const registry: PresenceRegistry | undefined = global.get(REGISTRY_KEY);

if (!registry) {
    message.payload = { error: "Presence registry not initialized" };
    message.statusCode = 500;
} else {
    const areas = Object.values(registry.areas).map(area => {
        // Read current state from global context (migrated from flow for cross-tab access)
        const flowInfoKey = `presenceFlowInfo.${area.topic}`;
        const presenceStatesKey = `presenceStates.${area.topic}`;

        // @ts-ignore
        const flowInfo = global.get(flowInfoKey) || {};
        // @ts-ignore
        const presenceStates = global.get(presenceStatesKey) || {};

        const now = Date.now();
        const inCooldown = flowInfo.coolDownEndTime ? now < flowInfo.coolDownEndTime : false;
        const cooldownRemainingMs = inCooldown ? flowInfo.coolDownEndTime - now : 0;

        return {
            topic: area.topic,
            sensors: area.sensors,
            entities: area.entities,
            coolDown: area.coolDown,
            enabled: area.enabled,
            currentState: {
                state: flowInfo.state || "off",
                prevState: flowInfo.prevState || "off",
                lastOn: flowInfo.lastOn ? new Date(flowInfo.lastOn).toISOString() : null,
                lastOff: flowInfo.lastOff ? new Date(flowInfo.lastOff).toISOString() : null,
                inCooldown,
                cooldownRemainingMs: Math.max(0, cooldownRemainingMs),
                cooldownRemainingMin: Math.round(cooldownRemainingMs / 60000 * 10) / 10,
                sensorStates: presenceStates
            }
        };
    });

    const summary = {
        total: areas.length,
        enabled: areas.filter(a => a.enabled).length,
        occupied: areas.filter(a => a.currentState.state === "on").length,
        pendingOff: areas.filter(a => a.currentState.state === "pending_off").length
    };

    message.payload = { areas, summary, lastSeeded: registry.lastSeeded };
    message.statusCode = 200;
}

// @ts-ignore
msg = message;
