/**
 * Get-Flow-Info InfluxDB Logger
 * Logs when the trigger node fires and get-flow-info checks cooldown status
 */

import { safeNumber, safeString, safeBooleanAsInt, sanitizeFields } from '../utils/influx-logger-base';

// @ts-ignore - Node-RED global
const message = msg;
const data = message.data || {};
const topic = message.topic || 'unknown';

// Get global context for current states (migrated from flow context)
// @ts-ignore
const flowInfo = global.get(`presenceFlowInfo.${topic}`) || {};
// @ts-ignore
const presenceStates = global.get(`presenceStates.${topic}`) || {};

// Determine if any sensors are on
const sensorsOn = Object.values(presenceStates).filter(state => state === 'on').length;
const totalSensors = Object.keys(presenceStates).length;
const hasPresence = sensorsOn > 0;

// Check cooldown status
const inCooldown = flowInfo.coolDownEndTime && Date.now() < flowInfo.coolDownEndTime;
const cooldownRemaining = flowInfo.coolDownEndTime ? Math.max(0, flowInfo.coolDownEndTime - Date.now()) : 0;

// Determine action taken
let action = 'none';
if (flowInfo.state === 'pending_off' && !inCooldown) {
    if (hasPresence) {
        action = 'cancelled_turnoff';
    } else {
        action = 'confirmed_turnoff';
    }
} else if (inCooldown) {
    action = 'still_in_cooldown';
}

// Set measurement for InfluxDB
message.measurement = 'get_flow_info_events';

// Create payload
message.payload = [{
    // Current state
    flow_state: safeString(flowInfo.state || 'unknown'),
    previous_state: safeString(flowInfo.prevState || 'unknown'),

    // Sensor states
    sensors_on: safeNumber(sensorsOn),
    total_sensors: safeNumber(totalSensors),
    has_presence: safeBooleanAsInt(hasPresence),
    sensor_states: safeString(JSON.stringify(presenceStates)),

    // Cooldown info
    in_cooldown: safeBooleanAsInt(inCooldown),
    cooldown_remaining_ms: safeNumber(cooldownRemaining),
    cooldown_end_time: safeNumber(flowInfo.coolDownEndTime || 0),

    // Action taken
    action: safeString(action),
    payload_exists: safeBooleanAsInt(message.payload !== null && message.payload !== undefined),

    // Timing
    last_on_ms: safeNumber(flowInfo.lastOn || 0),
    last_off_ms: safeNumber(flowInfo.lastOff || 0),
    time_since_last_on: safeNumber(flowInfo.lastOn ? Date.now() - flowInfo.lastOn : 0),
    time_since_last_off: safeNumber(flowInfo.lastOff ? Date.now() - flowInfo.lastOff : 0),

    // Message info
    delay_ms: safeNumber(message.delay || 0),
    reset_flag: safeBooleanAsInt(message.reset === true || message.reset === 1),

    // Timestamp
    timestamp_ms: Date.now()
}];

// Set tags for InfluxDB
message.tags = {
    flow: 'get_flow_info',
    topic: safeString(topic),
    state: safeString(flowInfo.state || 'unknown'),
    action: safeString(action),
    has_presence: hasPresence ? 'true' : 'false'
};