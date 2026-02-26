/**
 * Cooldown Ticker
 * Fires every 15s via inject node. For each area in pending_off state,
 * re-publishes the cooldown and state sensors with freshly computed
 * cooldown_remaining_ms so dashboard progress bars animate.
 *
 * Node wiring:
 *   [inject: 15s repeat] → [function: this] → [switch: has updates?] → [split] → [ha-api: POST /api/states/]
 *
 * Output: msg.payload = array of {entity_id, state, attributes} for HA REST API
 */

import type { PresenceRegistry } from "./types";
import { normalizeSensorConfig } from "./types";

// Format duration: never decimal minutes, roll to hours/days with 1 decimal
const formatDuration = (minutes: number): string => {
    if (minutes < 1) return "<1 min";
    if (minutes < 60) return `${Math.round(minutes)} min`;
    const hours = minutes / 60;
    if (hours < 24) return `${Math.round(hours * 10) / 10} hr`;
    const days = hours / 24;
    return `${Math.round(days * 10) / 10} day`;
};

// @ts-ignore - Node-RED global
const registry: PresenceRegistry | undefined = global.get("presenceRegistry");

if (!registry?.areas) {
    // @ts-ignore
    msg.payload = null;
} else {
    const now = Date.now();

    interface SensorUpdate {
        entity_id: string;
        state: string;
        attributes: Record<string, any>;
    }

    const updates: SensorUpdate[] = [];

    for (const [topic, area] of Object.entries(registry.areas)) {
        if (!area.enabled) continue;

        const flowInfoKey = `presenceFlowInfo.${topic}`;
        const presenceStatesKey = `presenceStates.${topic}`;
        // @ts-ignore
        const flowInfo = global.get(flowInfoKey);
        if (!flowInfo || flowInfo.state !== "pending_off") continue;
        if (!flowInfo.coolDownEndTime || now >= flowInfo.coolDownEndTime) continue;

        // @ts-ignore
        const presenceStates: Record<string, string> = global.get(presenceStatesKey) || {};

        const topicKey = topic.replace(/[^a-z0-9_]/g, "_");

        // Freshly compute cooldown values
        const cooldownRemainingMs = Math.max(0, flowInfo.coolDownEndTime - now);
        const cooldownRemainingMin = cooldownRemainingMs / 60000;
        const cooldownTotalMs = flowInfo.delay || 0;
        const cooldownTotalMin = cooldownTotalMs / 60000;

        // Dwell time
        const dwellMs = flowInfo.lastOn ? now - flowInfo.lastOn : 0;
        const dwellMinutes = dwellMs / 60000;

        // Sensor counts
        const sensorCount = Object.keys(presenceStates).length;
        const sensorsOn = Object.values(presenceStates).filter(s => s === "on").length;

        // Edge sensor list
        const edgeSensors = area.sensors
            .map(s => normalizeSensorConfig(s))
            .filter(s => s.triggerMode === "edge")
            .map(s => s.entity_id);

        // State sensor update (has cooldown attributes for dashboard cards)
        updates.push({
            entity_id: `sensor.presence_${topicKey}_state`,
            state: "pending_off",
            attributes: {
                friendly_name: `Presence ${topic.replace(/_/g, " ")} State`,
                icon: "mdi:timer-sand",
                dwell_minutes: Math.round(dwellMinutes * 10) / 10,
                dwell_formatted: formatDuration(dwellMinutes),
                cooldown_remaining_min: Math.round(cooldownRemainingMin * 10) / 10,
                cooldown_remaining_formatted: formatDuration(cooldownRemainingMin),
                cooldown_total_min: Math.round(cooldownTotalMin * 10) / 10,
                sensor_count: sensorCount,
                sensors_on: sensorsOn,
                last_on: flowInfo.lastOn ? new Date(flowInfo.lastOn).toISOString() : null,
                last_off: flowInfo.lastOff ? new Date(flowInfo.lastOff).toISOString() : null,
                trigger_sensor: "cooldown_ticker",
                trigger_state: "",
                enabled: area.enabled !== false,
                edge_sensors: edgeSensors
            }
        });

        // Cooldown sensor update (for gauge/progress bar cards)
        updates.push({
            entity_id: `sensor.presence_${topicKey}_cooldown`,
            state: String(Math.round(cooldownRemainingMin * 10) / 10),
            attributes: {
                friendly_name: `Presence ${topic.replace(/_/g, " ")} Cooldown`,
                icon: "mdi:timer-sand",
                unit_of_measurement: "min",
                cooldown_remaining_ms: Math.round(cooldownRemainingMs),
                cooldown_total_ms: Math.round(cooldownTotalMs),
                end_time: new Date(flowInfo.coolDownEndTime).toISOString(),
                total_seconds: Math.round(cooldownTotalMs / 1000),
                dwell_based: dwellMinutes > 0
            }
        });
    }

    // @ts-ignore
    msg.payload = updates.length > 0 ? updates : null;
}
