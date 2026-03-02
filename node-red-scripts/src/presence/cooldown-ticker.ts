/**
 * Cooldown Ticker
 * Fires every 15s via inject node. For each area in pending_off state,
 * re-publishes the cooldown and state sensors with freshly computed
 * cooldown_remaining_ms so dashboard progress bars animate.
 *
 * Also sweeps for stuck states:
 *   - pending_off with expired cooldown → complete transition to off + turn_off actions
 *   - stale "on" with all level sensors OFF for >20min → transition to off + turn_off actions
 *
 * Node wiring:
 *   [inject: 15s repeat] → [function: this] → [switch: has updates?] → [split] → [ha-api: POST /api/states/]
 *                                            └→ [change: sweepActions→payload] → [switch: not null?] → [split] → [api-call-service]
 *
 * Output:
 *   msg.payload = array of {entity_id, state, attributes} for HA REST API (sensor updates)
 *   msg.sweepActions = array of grouped service call actions (entity turn_off)
 */

import type { PresenceRegistry } from "./types";
import { normalizeSensorConfig } from "./types";
import { isSensorStale } from "./utils";
import { getEntity } from "../utils/entities";
import { groupActions } from "../utils/service-calls";
import { filterBlacklistedEntity } from "../utils/utils";

import { formatDuration } from "../utils/datetime";

// Stale "on" threshold: 20 minutes with all level sensors OFF
const STALE_ON_THRESHOLD_MS = 20 * 60 * 1000;

// @ts-ignore - Node-RED global
const registry: PresenceRegistry | undefined = global.get("presenceRegistry");

if (!registry?.areas) {
    // @ts-ignore
    msg.payload = null;
    // @ts-ignore
    msg.sweepActions = null;
} else {
    const now = Date.now();

    interface SensorUpdate {
        entity_id: string;
        state: string;
        attributes: Record<string, any>;
    }

    const updates: SensorUpdate[] = [];
    const sweepRawActions: Partial<Hass.Service & Hass.Action>[] = [];
    const sweepLog: string[] = [];

    for (const [topic, area] of Object.entries(registry.areas)) {
        if (!area.enabled) continue;

        const flowInfoKey = `presenceFlowInfo.${topic}`;
        const presenceStatesKey = `presenceStates.${topic}`;
        // @ts-ignore
        const flowInfo = global.get(flowInfoKey);
        if (!flowInfo) continue;

        const topicKey = topic.replace(/[^a-z0-9_]/g, "_");

        // @ts-ignore
        const presenceStates: Record<string, string> = global.get(presenceStatesKey) || {};

        // Resolve sensor configs for edge-trigger filtering
        const sensorConfigs = area.sensors.map(s => normalizeSensorConfig(s));

        // Get level sensor states (edge sensors don't sustain presence)
        const levelSensorStates = Object.entries(presenceStates)
            .filter(([id]) => {
                const cfg = sensorConfigs.find(s => s.entity_id === id);
                return !cfg || cfg.triggerMode !== "edge";
            })
            .map(([, state]) => state);

        // Also check live HA state for level sensors (presenceStates may be stale)
        // Filter out sensors stuck "on" for >60min (hardware/protocol stuck)
        const liveLevelSensors = sensorConfigs.filter(s => s.triggerMode !== "edge");
        const liveLevelSensorStates = liveLevelSensors.map(s => {
            const entity = getEntity(s.entity_id);
            return entity?.state || "unknown";
        });

        const anyLiveLevelSensorOn = liveLevelSensors.some(s => {
            const entity = getEntity(s.entity_id);
            if (!entity || entity.state !== "on") return false;
            if (isSensorStale(s.entity_id)) {
                const elapsedMin = entity.last_changed
                    ? Math.round((Date.now() - new Date(entity.last_changed).getTime()) / 60000)
                    : "?";
                // @ts-ignore
                node.warn(`Stale sensor detected: ${s.entity_id} (on for ${elapsedMin}min, topic=${topic})`);
                return false;
            }
            return true;
        });

        // === SWEEP: Expired pending_off ===
        if (flowInfo.state === "pending_off" && (!flowInfo.coolDownEndTime || now >= flowInfo.coolDownEndTime)) {
            // Cooldown expired but state never transitioned — the trigger node message was lost

            // Get filtered entities for turn_off actions
            const filteredEntities = area.entities
                .filter(e => filterBlacklistedEntity(e.entity_id));

            if (anyLiveLevelSensorOn) {
                // Motion detected during the lost cooldown — transition back to "on"
                flowInfo.state = "on";
                flowInfo.prevState = "pending_off";
                flowInfo.lastOff = null;
                flowInfo.delay = 0;
                flowInfo.coolDownEndTime = null;
                // Don't update lastOn — preserve dwell time

                // @ts-ignore
                global.set(flowInfoKey, flowInfo);

                sweepLog.push(`${topic}: pending_off→on (sensors active during expired cooldown)`);

                // Publish updated state sensor
                const dwellMs = flowInfo.lastOn ? now - flowInfo.lastOn : 0;
                const dwellMinutes = dwellMs / 60000;
                updates.push({
                    entity_id: `sensor.presence_${topicKey}_state`,
                    state: "on",
                    attributes: {
                        friendly_name: `Presence ${topic.replace(/_/g, " ")} State`,
                        icon: "mdi:motion-sensor",
                        dwell_minutes: Math.round(dwellMinutes * 10) / 10,
                        dwell_formatted: formatDuration(dwellMinutes),
                        cooldown_remaining_min: 0,
                        cooldown_remaining_formatted: "0 min",
                        cooldown_total_min: 0,
                        sensor_count: Object.keys(presenceStates).length,
                        sensors_on: liveLevelSensorStates.filter(s => s === "on").length,
                        last_on: flowInfo.lastOn ? new Date(flowInfo.lastOn).toISOString() : null,
                        last_off: null,
                        trigger_sensor: "sweep_recovery",
                        trigger_state: "",
                        enabled: area.enabled !== false,
                        edge_sensors: sensorConfigs.filter(s => s.triggerMode === "edge").map(s => s.entity_id)
                    }
                });
                updates.push({
                    entity_id: `sensor.presence_${topicKey}_cooldown`,
                    state: "0",
                    attributes: {
                        friendly_name: `Presence ${topic.replace(/_/g, " ")} Cooldown`,
                        icon: "mdi:timer-sand",
                        unit_of_measurement: "min",
                        cooldown_remaining_ms: 0,
                        cooldown_total_ms: 0,
                        end_time: null,
                        total_seconds: 0,
                        dwell_based: false
                    }
                });
            } else {
                // Sensors OFF — complete the transition to "off"
                flowInfo.state = "off";
                flowInfo.prevState = "pending_off";
                flowInfo.lastOff = now;
                flowInfo.delay = 0;
                flowInfo.coolDownEndTime = null;

                // @ts-ignore
                global.set(flowInfoKey, flowInfo);

                // Generate turn_off actions for entities that are still on
                for (const e of filteredEntities) {
                    const entity = getEntity(e.entity_id);
                    if (entity && entity.state === "on") {
                        sweepRawActions.push({
                            action: "homeassistant.turn_off",
                            target: { entity_id: e.entity_id }
                        });
                    }
                }

                sweepLog.push(`${topic}: pending_off→off (expired cooldown swept)`);

                // Publish updated state sensor
                updates.push({
                    entity_id: `sensor.presence_${topicKey}_state`,
                    state: "off",
                    attributes: {
                        friendly_name: `Presence ${topic.replace(/_/g, " ")} State`,
                        icon: "mdi:motion-sensor-off",
                        dwell_minutes: 0,
                        dwell_formatted: "<1 min",
                        cooldown_remaining_min: 0,
                        cooldown_remaining_formatted: "0 min",
                        cooldown_total_min: 0,
                        sensor_count: Object.keys(presenceStates).length,
                        sensors_on: 0,
                        last_on: flowInfo.lastOn ? new Date(flowInfo.lastOn).toISOString() : null,
                        last_off: new Date(now).toISOString(),
                        trigger_sensor: "sweep_expired",
                        trigger_state: "",
                        enabled: area.enabled !== false,
                        edge_sensors: sensorConfigs.filter(s => s.triggerMode === "edge").map(s => s.entity_id)
                    }
                });
                updates.push({
                    entity_id: `sensor.presence_${topicKey}_cooldown`,
                    state: "0",
                    attributes: {
                        friendly_name: `Presence ${topic.replace(/_/g, " ")} Cooldown`,
                        icon: "mdi:timer-sand",
                        unit_of_measurement: "min",
                        cooldown_remaining_ms: 0,
                        cooldown_total_ms: 0,
                        end_time: null,
                        total_seconds: 0,
                        dwell_based: false
                    }
                });
            }

            continue; // Skip normal ticker update for this area
        }

        // === SWEEP: All "on" sensors are stale (hardware stuck) ===
        // Fires immediately when every level sensor reporting "on" has been unchanged for >60min.
        // No dwell requirement — the sensor staleness threshold is the primary gate.
        if (flowInfo.state === "on" && !anyLiveLevelSensorOn) {
            // Check if any level sensor is actually reporting "on" at hardware level (just stale)
            const anyHardwareOn = liveLevelSensors.some(s => {
                const entity = getEntity(s.entity_id);
                return entity?.state === "on";
            });
            if (anyHardwareOn) {
                // Hardware says "on" but all are stale — stuck sensor scenario
                const filteredEntities = area.entities
                    .filter(e => filterBlacklistedEntity(e.entity_id));

                flowInfo.state = "off";
                flowInfo.prevState = "on";
                flowInfo.lastOff = now;
                flowInfo.delay = 0;
                flowInfo.coolDownEndTime = null;

                // @ts-ignore
                global.set(flowInfoKey, flowInfo);

                for (const e of filteredEntities) {
                    const entity = getEntity(e.entity_id);
                    if (entity && entity.state === "on") {
                        sweepRawActions.push({
                            action: "homeassistant.turn_off",
                            target: { entity_id: e.entity_id }
                        });
                    }
                }

                sweepLog.push(`${topic}: on→off (all "on" sensors stale >60min, hardware stuck)`);

                updates.push({
                    entity_id: `sensor.presence_${topicKey}_state`,
                    state: "off",
                    attributes: {
                        friendly_name: `Presence ${topic.replace(/_/g, " ")} State`,
                        icon: "mdi:motion-sensor-off",
                        dwell_minutes: 0,
                        dwell_formatted: "<1 min",
                        cooldown_remaining_min: 0,
                        cooldown_remaining_formatted: "0 min",
                        cooldown_total_min: 0,
                        sensor_count: Object.keys(presenceStates).length,
                        sensors_on: 0,
                        last_on: flowInfo.lastOn ? new Date(flowInfo.lastOn).toISOString() : null,
                        last_off: new Date(now).toISOString(),
                        trigger_sensor: "sweep_stale_sensor",
                        trigger_state: "",
                        enabled: area.enabled !== false,
                        edge_sensors: sensorConfigs.filter(s => s.triggerMode === "edge").map(s => s.entity_id)
                    }
                });
                updates.push({
                    entity_id: `sensor.presence_${topicKey}_cooldown`,
                    state: "0",
                    attributes: {
                        friendly_name: `Presence ${topic.replace(/_/g, " ")} Cooldown`,
                        icon: "mdi:timer-sand",
                        unit_of_measurement: "min",
                        cooldown_remaining_ms: 0,
                        cooldown_total_ms: 0,
                        end_time: null,
                        total_seconds: 0,
                        dwell_based: false
                    }
                });

                continue;
            }
        }

        // === SWEEP: Stale "on" with all level sensors OFF (20min dwell) ===
        if (flowInfo.state === "on" && flowInfo.lastOn && (now - flowInfo.lastOn) > STALE_ON_THRESHOLD_MS) {
            if (!anyLiveLevelSensorOn) {
                // All level sensors are OFF for >20min but DFA is stuck on "on"
                const filteredEntities = area.entities
                    .filter(e => filterBlacklistedEntity(e.entity_id));

                flowInfo.state = "off";
                flowInfo.prevState = "on";
                flowInfo.lastOff = now;
                flowInfo.delay = 0;
                flowInfo.coolDownEndTime = null;

                // @ts-ignore
                global.set(flowInfoKey, flowInfo);

                for (const e of filteredEntities) {
                    const entity = getEntity(e.entity_id);
                    if (entity && entity.state === "on") {
                        sweepRawActions.push({
                            action: "homeassistant.turn_off",
                            target: { entity_id: e.entity_id }
                        });
                    }
                }

                sweepLog.push(`${topic}: on→off (stale on, all sensors OFF for >${STALE_ON_THRESHOLD_MS / 60000}min)`);

                // Publish updated state sensor
                updates.push({
                    entity_id: `sensor.presence_${topicKey}_state`,
                    state: "off",
                    attributes: {
                        friendly_name: `Presence ${topic.replace(/_/g, " ")} State`,
                        icon: "mdi:motion-sensor-off",
                        dwell_minutes: 0,
                        dwell_formatted: "<1 min",
                        cooldown_remaining_min: 0,
                        cooldown_remaining_formatted: "0 min",
                        cooldown_total_min: 0,
                        sensor_count: Object.keys(presenceStates).length,
                        sensors_on: 0,
                        last_on: flowInfo.lastOn ? new Date(flowInfo.lastOn).toISOString() : null,
                        last_off: new Date(now).toISOString(),
                        trigger_sensor: "sweep_stale_on",
                        trigger_state: "",
                        enabled: area.enabled !== false,
                        edge_sensors: sensorConfigs.filter(s => s.triggerMode === "edge").map(s => s.entity_id)
                    }
                });
                updates.push({
                    entity_id: `sensor.presence_${topicKey}_cooldown`,
                    state: "0",
                    attributes: {
                        friendly_name: `Presence ${topic.replace(/_/g, " ")} Cooldown`,
                        icon: "mdi:timer-sand",
                        unit_of_measurement: "min",
                        cooldown_remaining_ms: 0,
                        cooldown_total_ms: 0,
                        end_time: null,
                        total_seconds: 0,
                        dwell_based: false
                    }
                });

                continue; // Skip normal ticker update
            }
        }

        // === NORMAL TICKER: Active pending_off with valid cooldown ===
        if (flowInfo.state !== "pending_off") continue;
        if (!flowInfo.coolDownEndTime || now >= flowInfo.coolDownEndTime) continue;

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
        const edgeSensors = sensorConfigs
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

    // Log sweep actions
    if (sweepLog.length > 0) {
        // @ts-ignore
        node.warn(`Cooldown sweep: ${sweepLog.join("; ")}`);
    }

    // @ts-ignore
    msg.payload = updates.length > 0 ? updates : null;

    // Group and output sweep actions
    // @ts-ignore
    msg.sweepActions = sweepRawActions.length > 0 ? groupActions(sweepRawActions) : null;
}
