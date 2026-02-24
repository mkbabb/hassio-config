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
            cooldown_remaining_min: Math.round(cooldownRemainingMin * 10) / 10,
            cooldown_total_min: Math.round(cooldownTotalMin * 10) / 10,
            sensor_count: sensorCount,
            sensors_on: sensorsOn,
            last_on: flowInfo.lastOn ? new Date(flowInfo.lastOn).toISOString() : null,
            last_off: flowInfo.lastOff ? new Date(flowInfo.lastOff).toISOString() : null,
            trigger_sensor: debug.trigger_sensor || message.data?.entity_id || "",
            trigger_state: message.state || ""
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
