/**
 * Cache State Publisher
 * Publishes cache system state as HA sensor entities.
 *
 * Node wiring:
 *   [home-status debouncer output] → [function: this] → [split] → [ha-api: POST /api/states/] → [join]
 *
 * Input: msg.state ("home"/"away"), msg.cachedStates, msg.debug
 * Output: msg.payload = array of {entity_id, state, attributes} for HA REST API
 *
 * Deduplication: Only publishes changed state.
 */

import { GLOBAL_CACHED_STATES_KEY } from "../utils/utils";

// @ts-ignore - Node-RED global
const message = msg;

const PUBLISHED_KEY = "publishedCacheStates";

// @ts-ignore
const lastPublished: Record<string, any> = flow.get(PUBLISHED_KEY) ?? {};

const now = new Date();
const debug = message.debug || {};

const cacheStatus = message.state || "unknown";
const cachedStates: any[] = Array.isArray(message.cachedStates) ? message.cachedStates : [];
const operation = debug.operation || (cacheStatus === "away" ? "snapshot" : cacheStatus === "home" ? "restore" : "unknown");

interface SensorUpdate {
    entity_id: string;
    state: string;
    attributes: Record<string, any>;
}

const updates: SensorUpdate[] = [];

// Cache status sensor
updates.push({
    entity_id: "sensor.cache_state_status",
    state: cacheStatus,
    attributes: {
        friendly_name: "Cache State Status",
        icon: cacheStatus === "home" ? "mdi:home"
            : cacheStatus === "away" ? "mdi:home-export-outline"
            : "mdi:home-switch",
        cached_entity_count: cachedStates.length,
        last_snapshot: cacheStatus === "away" ? now.toISOString() : (lastPublished["sensor.cache_state_status"]?.attributes?.last_snapshot || null),
        last_restore: cacheStatus === "home" ? now.toISOString() : (lastPublished["sensor.cache_state_status"]?.attributes?.last_restore || null),
        transition_direction: cacheStatus === "away" ? "departing" : cacheStatus === "home" ? "arriving" : "stable"
    }
});

// Last operation sensor
updates.push({
    entity_id: "sensor.cache_state_last_operation",
    state: operation,
    attributes: {
        friendly_name: "Cache State Last Operation",
        icon: operation === "snapshot" ? "mdi:camera"
            : operation === "restore" ? "mdi:restore"
            : "mdi:help-circle",
        entity_count: cachedStates.length,
        timestamp: now.toISOString()
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

// @ts-ignore
flow.set(PUBLISHED_KEY, newPublished);

// @ts-ignore
msg.payload = changedUpdates.length > 0 ? changedUpdates : null;
// @ts-ignore
msg.sensorUpdateCount = changedUpdates.length;
