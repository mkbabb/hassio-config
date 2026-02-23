/**
 * Plants InfluxDB Logger
 * Logs grow light static state changes
 *
 * Upstream (set-static-state.ts) sets:
 *   msg.staticStates = { plants: { entityId: state } }
 *   msg.payload = { entity_id, state }
 */

import { safeNumber, safeString, sanitizeFields } from '../utils/influx-logger-base';

// @ts-ignore - Node-RED global
const message = msg;
const staticStates = message.staticStates?.plants || {};
const payload = message.payload || {};

message.measurement = 'plant_events';

const fields = {
    entity_id: safeString(payload.entity_id || 'unknown'),
    current_state: safeString(payload.state || 'unknown'),
    static_states: safeString(JSON.stringify(staticStates)),
    static_state_count: safeNumber(Object.keys(staticStates).length),
    timestamp_ms: safeNumber(Date.now())
};

const tags = {
    flow: 'plants',
    entity_id: safeString(payload.entity_id || 'unknown'),
    entity_type: payload.entity_id ? (payload.entity_id.includes('grow') ? 'grow_light' : 'other') : 'unknown',
    event_type: 'static_state_change'
};

message.payload = [sanitizeFields(fields), tags];
