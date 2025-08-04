/**
 * Presence InfluxDB Logger
 * Logs presence detection events and state transitions
 */

// @ts-ignore - Node-RED global
const message = msg;
const debug = message.debug || {};

// Skip if no debug data - set empty payload
if (!debug || !message.presenceState) {
    message.measurement = 'presence_events';
    message.payload = [];
    message.tags = { flow: 'presence', skip: 'true' };
} else {
    // Set measurement for InfluxDB
    message.measurement = 'presence_events';

    // Create payload with all presence metrics
    message.payload = [{
        // Core presence data
        presence_state: message.presenceState || 'unknown',
        aggregate_state: message.aggregateState || 'unknown',
        state_transition: debug.stateTransition || 'unknown',
        
        // Numeric states for graphing
        state_numeric: message.presenceState === 'on' ? 1 : 
                      message.presenceState === 'pending_off' ? 0.5 : 
                      message.presenceState === 'unknown' ? -1 : 0,
        
        // Sensor metrics
        sensor_count: debug.sensorCount || 0,
        entity_count: message.entities?.length || 0,
        
        // Timing metrics
        cool_down_seconds: debug.coolDownSeconds || 0,
        delay_ms: debug.actualDelayMs || 0,
        time_since_last_on: debug.timeSinceLastOn || 0,
        time_since_last_off: debug.timeSinceLastOff || 0,
        
        // State flags
        in_cool_down: message.inCoolDown ? 1 : 0,
        has_action: message.payload ? 1 : 0,
        is_off_unknown_off: debug.isOffUnknownOffSequence ? 1 : 0,
        
        // Previous states
        previous_state: debug.prevState || 'unknown',
        previous_previous_state: debug.prevPrevState || 'unknown',
    
    // Sensor states as JSON string
    sensor_states: JSON.stringify(message.presenceStates || {}),
    
        // Action details
        action: message.payload ? JSON.stringify(message.payload).substring(0, 500) : 'none',
        entities_controlled: message.entities ? message.entities.map((e: any) => e.entity_id).join(',') : '',
        
        // Timestamp
        timestamp_ms: Date.now()
    }];

    // Add tags for filtering and grouping
    message.tags = {
        flow: 'presence',
        topic: message.topic || message.data?.entity_id || 'unknown',
        sensor_id: message.data?.entity_id || 'unknown',
        current_state: message.presenceState || 'unknown',
        previous_state: debug.prevState || 'unknown',
        has_action: message.payload ? 'true' : 'false',
        event_type: determineEventType()
    };

    // Helper function to determine event type
    function determineEventType() {
        const transition = debug.stateTransition || '';
        if (transition.includes('off → on')) return 'activation';
        if (transition.includes('on → pending_off')) return 'cool_down_start';
        if (transition.includes('pending_off → on')) return 'cool_down_cancel';
        if (transition.includes('pending_off → off')) return 'cool_down_complete';
        if (transition.includes('unknown')) return 'unknown_transition';
        return 'state_change';
    }
}