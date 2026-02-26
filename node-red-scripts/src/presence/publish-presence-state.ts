/**
 * Presence State Publisher
 * Publishes presence area states as HA sensor entities.
 *
 * Node wiring:
 *   [presence engine output] → [function: this] → [split] → [ha-api: POST /api/states/] → [join]
 *
 * Input: msg.presenceState, msg.flowInfo, msg.presenceStates, msg.topic, msg.debug
 * Output: msg.payload = array of {entity_id, state, attributes} for HA REST API
 *
 * Deduplication: Only publishes changed state per topic.
 */

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
const message = msg;

const PUBLISHED_KEY = "publishedPresenceStates";

// @ts-ignore — ephemeral dedup cache, not persisted across restarts
const lastPublished: Record<string, any> = flow.get(PUBLISHED_KEY, "memory") ?? {};

const topic: string = message.topic || "unknown";
const presenceState: string = message.presenceState || "unknown";
const flowInfo = message.flowInfo || {};
const presenceStates: Record<string, string> = message.presenceStates || {};
const debug = message.debug || {};

// Read enabled status and sensor config from registry
// @ts-ignore
const registry = global.get("presenceRegistry");
const areaConfig = registry?.areas?.[topic];
const enabled = areaConfig?.enabled !== false;

// Resolve sensor configs for edge-trigger info in attributes
const sensorConfigs: Array<{ entity_id: string; triggerMode: string }> = (areaConfig?.sensors || []).map(
    (s: any) => typeof s === "string" ? { entity_id: s, triggerMode: "level" } : s
);

// Skip if no meaningful state
if (!topic || topic === "unknown" || !message.presenceState) {
    // @ts-ignore
    msg.payload = null;
} else {
    const topicKey = topic.replace(/[^a-z0-9_]/g, "_");
    const now = Date.now();

    interface SensorUpdate {
        entity_id: string;
        state: string;
        attributes: Record<string, any>;
    }

    const updates: SensorUpdate[] = [];

    // Calculate dwell time
    const dwellMs = flowInfo.lastOn ? now - flowInfo.lastOn : 0;
    const dwellMinutes = dwellMs / 60000;

    // Calculate cooldown remaining
    const cooldownRemainingMs = flowInfo.coolDownEndTime
        ? Math.max(0, flowInfo.coolDownEndTime - now)
        : 0;
    const cooldownRemainingMin = cooldownRemainingMs / 60000;
    const cooldownTotalMs = flowInfo.delay || 0;
    const cooldownTotalMin = cooldownTotalMs / 60000;

    // Sensor counts
    const sensorCount = Object.keys(presenceStates).length;
    const sensorsOn = Object.values(presenceStates).filter(s => s === "on").length;

    // State sensor
    updates.push({
        entity_id: `sensor.presence_${topicKey}_state`,
        state: presenceState,
        attributes: {
            friendly_name: `Presence ${topic.replace(/_/g, " ")} State`,
            icon: presenceState === "on" ? "mdi:motion-sensor"
                : presenceState === "pending_off" ? "mdi:timer-sand"
                : "mdi:motion-sensor-off",
            dwell_minutes: Math.round(dwellMinutes * 10) / 10,
            dwell_formatted: formatDuration(dwellMinutes),
            cooldown_remaining_min: Math.round(cooldownRemainingMin * 10) / 10,
            cooldown_remaining_formatted: formatDuration(cooldownRemainingMin),
            cooldown_total_min: Math.round(cooldownTotalMin * 10) / 10,
            sensor_count: sensorCount,
            sensors_on: sensorsOn,
            last_on: flowInfo.lastOn ? new Date(flowInfo.lastOn).toISOString() : null,
            last_off: flowInfo.lastOff ? new Date(flowInfo.lastOff).toISOString() : null,
            trigger_sensor: debug.trigger_sensor || message.data?.entity_id || "",
            trigger_state: message.state || "",
            enabled,
            edge_sensors: sensorConfigs.filter(s => s.triggerMode === "edge").map(s => s.entity_id)
        }
    });

    // Cooldown sensor (useful for gauge cards)
    updates.push({
        entity_id: `sensor.presence_${topicKey}_cooldown`,
        state: String(Math.round(cooldownRemainingMin * 10) / 10),
        attributes: {
            friendly_name: `Presence ${topic.replace(/_/g, " ")} Cooldown`,
            icon: "mdi:timer-sand",
            unit_of_measurement: "min",
            cooldown_remaining_ms: Math.round(cooldownRemainingMs),
            cooldown_total_ms: Math.round(cooldownTotalMs),
            end_time: flowInfo.coolDownEndTime
                ? new Date(flowInfo.coolDownEndTime).toISOString()
                : null,
            total_seconds: Math.round(cooldownTotalMs / 1000),
            dwell_based: dwellMinutes > 0
        }
    });

    // Deduplication
    const changedUpdates: SensorUpdate[] = [];
    const newPublished = { ...lastPublished };

    for (const update of updates) {
        const key = update.entity_id;
        const prev = lastPublished[key];
        const current = { state: update.state, attributes: update.attributes };

        if (!prev || prev.state !== current.state || JSON.stringify(prev.attributes) !== JSON.stringify(current.attributes)) {
            changedUpdates.push(update);
        }
        newPublished[key] = current;
    }

    // @ts-ignore — ephemeral dedup cache (memory store)
    flow.set(PUBLISHED_KEY, newPublished, "memory");

    // @ts-ignore
    msg.payload = changedUpdates.length > 0 ? changedUpdates : null;
    // @ts-ignore
    msg.sensorUpdateCount = changedUpdates.length;
}
