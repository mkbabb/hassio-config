/**
 * Presence InfluxDB Logger
 * Enhanced logging with state history and comprehensive debug data
 */

import { safeNumber, safeString, safeBooleanAsInt, sanitizeFields } from '../utils/influx-logger-base';

// @ts-ignore - Node-RED global
const message = msg;
const debug = message.debug || {};
const flowInfo = message.flowInfo || {};

// Skip if no debug data - set a minimal valid payload
if (!debug || !message.presenceState) {
    message.measurement = 'presence_events';
    message.payload = [{
        presence_state: 'unknown',
        aggregate_state: 'unknown',
        state_transition: 'none',
        sensor_count: 0,
        entity_count: 0,
        cool_down_seconds: 0,
        delay_ms: 0,
        in_cool_down: 0,
        has_action: 0,
        flow_state: 'unknown',
        action: 'none'
    }, {
        flow: 'presence',
        skip: 'true',
        event_type: 'skip',
        topic: 'unknown',
        current_state: 'unknown'
    }];
} else {
    // Set measurement for InfluxDB
    message.measurement = 'presence_events';

    // Helper function to determine event type
    function determineEventType() {
        const transition = debug.stateTransition || debug.currentState || '';
        if (transition.includes('off → on') || transition.includes('reset → on')) return 'activation';
        if (transition.includes('on → pending_off')) return 'cool_down_start';
        if (transition.includes('pending_off → on')) return 'cool_down_cancel';
        if (transition.includes('pending_off → off')) return 'cool_down_complete';
        if (transition.includes('→ reset') || transition.includes('reset →')) return 'reset_sequence';
        if (transition.includes('unknown')) return 'unknown_transition';
        if (transition.includes('ignored')) return 'debounced';
        return 'state_change';
    }

    // Create comprehensive metrics with type safety
    const fields = {
        // Core presence data
        presence_state: safeString(message.presenceState || 'unknown'),
        aggregate_state: safeString(message.aggregateState || 'unknown'),
        state_transition: safeString(debug.stateTransition || debug.currentState || 'unknown'),
        
        // Numeric states for graphing
        state_numeric: message.presenceState === 'on' ? 1 : 
                      message.presenceState === 'pending_off' ? 0.5 : 
                      message.presenceState === 'reset' ? -0.5 :
                      message.presenceState === 'unknown' ? -1 : 0,
        
        // Sensor metrics
        sensor_count: safeNumber(debug.sensorCount || Object.keys(message.presenceStates || {}).length),
        entity_count: safeNumber(message.entities?.length || 0),
        
        // Enhanced timing metrics
        cool_down_seconds: safeNumber(debug.coolDownSeconds || 0),
        delay_ms: safeNumber(debug.actualDelayMs || message.delay || 0),
        time_since_last_on: safeNumber(debug.timeSinceLastOn || flowInfo.timeSinceLastOn || 0),
        time_since_last_off: safeNumber(debug.timeSinceLastOff || flowInfo.timeSinceLastOff || 0),
        dwell_time: safeNumber(flowInfo.lastOn && flowInfo.lastOff ? 
                              Math.abs(flowInfo.lastOff - flowInfo.lastOn) : 0),
        
        // State flags
        in_cool_down: safeBooleanAsInt(message.inCoolDown),
        has_action: safeBooleanAsInt(message.payload !== null && message.payload !== undefined),
        
        // Enhanced state history
        previous_state: safeString(debug.prevState || flowInfo.prevState || 'unknown'),
        previous_previous_state: safeString(debug.prevPrevState || flowInfo.prevPrevState || 'unknown'),
        
        // Flow context data
        flow_state: safeString(flowInfo.state || 'unknown'),
        flow_delay: safeNumber(flowInfo.delay || 0),
        
        // Sensor states as JSON string
        sensor_states: safeString(JSON.stringify(message.presenceStates || {})),
        
        // Action details with length limit
        action: (message.payload !== null && message.payload !== undefined) ?
                safeString(JSON.stringify(message.payload).substring(0, 1000)) : 'none',
        entities_controlled: message.entities ? 
                           safeString(message.entities.map((e: any) => e.entity_id).join(',')) : '',
        
        // Trigger information
        trigger_sensor: safeString(message.data?.entity_id || message.topic || 'unknown'),
        trigger_state: safeString(message.state || 'unknown')
    };

    // Enhanced tags for filtering and grouping
    const tags = {
        flow: 'presence',
        topic: safeString(message.topic || message.data?.entity_id || 'unknown'),
        sensor_id: safeString(message.data?.entity_id || 'unknown'),
        room: safeString(extractRoomFromTopic(message.topic || '')),
        current_state: safeString(message.presenceState || 'unknown'),
        previous_state: safeString(debug.prevState || 'unknown'),
        has_action: (message.payload !== null && message.payload !== undefined) ? 'true' : 'false',
        event_type: determineEventType(),
        trigger_type: safeString(message.state === 'reset' ? 'reset' :
                                message.state === 'ignored' ? 'debounced' : 'sensor'),
        action_count: safeString(Array.isArray(message.payload) ? message.payload.length.toString() : '0')
    };

    // Sanitize and set payload with tags as second element (influxdb 1.x format)
    message.payload = [sanitizeFields(fields), tags];

    // Helper function to extract room from topic
    function extractRoomFromTopic(topic: string): string {
        if (!topic) return 'unknown';
        // Extract room name from topics like "downstairs_bathroom"
        const parts = topic.split('_');
        if (parts.length >= 2) {
            return parts.slice(0, -1).join('_');
        }
        return topic;
    }
}