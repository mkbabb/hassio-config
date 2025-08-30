/**
 * Garage Door InfluxDB Logger
 * Logs garage door automation events, triggers, and decisions
 */

import { safeNumber, safeString, safeBooleanAsInt, sanitizeFields } from '../utils/influx-logger-base';

// @ts-ignore - Node-RED global
const message = msg;
const debug = message.debug || {};

// Set measurement name
message.measurement = 'garage_door_events';

// Skip if no debug data
if (!debug || Object.keys(debug).length === 0) {
    message.payload = [];
    message.tags = { flow: 'garage_door', skip: 'true' };
} else {
    // Helper function to determine event classification
    function determineEventClass(): string {
        if (!debug.triggered) return 'suppressed';
        const reason = debug.reason || '';
        if (reason.includes('departure')) return 'departure';
        if (reason.includes('arrival')) return 'arrival';
        if (reason.includes('motion')) return 'motion_triggered';
        if (reason === 'user_present') return 'user_activity';
        return 'other';
    }

    // Helper function to determine suppression reason
    function getSuppressionReason(): string {
        const conditions = debug.conditions || {};
        if (!conditions.garageClosed) return 'garage_already_open';
        // Tesla location check removed as it's unreliable
        if (!conditions.userHome) return 'user_not_home';
        if (conditions.nightOrAsleep) return 'night_or_asleep';
        if (conditions.inCooldown) return 'cooldown_active';
        return 'none';
    }

    // Create comprehensive metrics with type safety
    const fields = {
        // Core event data
        triggered: safeBooleanAsInt(debug.triggered),
        trigger_reason: safeString(debug.reason || 'no_trigger'),
        event_class: safeString(determineEventClass()),
        suppression_reason: safeString(getSuppressionReason()),
        
        // Numeric state for graphing (1 = opened, 0 = no action, -1 = suppressed)
        action_numeric: debug.triggered ? 1 : (debug.reason === 'no_trigger' ? 0 : -1),
        
        // Condition states
        garage_closed: safeBooleanAsInt(debug.conditions?.garageClosed),
        tesla_location_state: safeString(debug.conditions?.teslaLocation || 'unknown'),
        user_home: safeBooleanAsInt(debug.conditions?.userHome),
        night_or_asleep: safeBooleanAsInt(debug.conditions?.nightOrAsleep),
        in_cooldown: safeBooleanAsInt(debug.conditions?.inCooldown),
        
        // Timing metrics (all in seconds)
        time_since_unplug: safeNumber(debug.timers?.sinceUnplug || 0),
        time_since_motion: safeNumber(debug.timers?.sinceMotion || 0),
        time_since_last_open: safeNumber(debug.timers?.sinceLastOpen || 0),
        
        // Time window checks
        within_charger_window: safeBooleanAsInt(
            (debug.timers?.sinceUnplug || Infinity) < 120 // 2 minutes
        ),
        within_motion_window: safeBooleanAsInt(
            (debug.timers?.sinceMotion || Infinity) < 30 // 30 seconds
        ),
        
        // Entity states
        user_present: safeBooleanAsInt(debug.states?.userPresent),
        tesla_doors_open: safeBooleanAsInt(debug.states?.teslaDoorsOpen),
        tesla_location: safeString(debug.states?.teslaLocation || 'unknown'),
        home_status: safeString(debug.states?.homeStatus || 'unknown'),
        day_status: safeString(debug.states?.dayStatus || 'unknown'),
        awake_status: safeString(debug.states?.awakeStatus || 'unknown'),
        
        // Trigger entity
        trigger_entity: safeString(message.topic || 'unknown'),
        trigger_state: safeString(message.payload || 'unknown'),
        
        // Action details
        has_action: safeBooleanAsInt(message.payload !== null && message.payload !== undefined),
        action: message.payload ? safeString(JSON.stringify(message.payload).substring(0, 500)) : 'none',
        
        // Correlation flags
        is_departure_sequence: safeBooleanAsInt(
            debug.reason?.includes('departure') || false
        ),
        is_arrival_sequence: safeBooleanAsInt(
            debug.reason === 'arrival'
        ),
        is_motion_correlation: safeBooleanAsInt(
            debug.reason?.includes('motion') || false
        ),
        
        // Detailed debug info as JSON (limited length)
        conditions_json: safeString(JSON.stringify(debug.conditions || {}).substring(0, 500)),
        timers_json: safeString(JSON.stringify(debug.timers || {}).substring(0, 500)),
        states_json: safeString(JSON.stringify(debug.states || {}).substring(0, 500))
    };

    // Sanitize and set payload
    message.payload = [sanitizeFields(fields)];

    // Enhanced tags for filtering and grouping
    message.tags = {
        flow: 'garage_door',
        trigger_entity: safeString(message.topic || 'unknown'),
        trigger_type: safeString(
            message.topic?.includes('motion') ? 'motion' :
            message.topic?.includes('charger') ? 'charger' :
            message.topic?.includes('user_present') ? 'user_present' :
            message.topic?.includes('doors') ? 'doors' :
            message.topic?.includes('location') ? 'location' :
            'other'
        ),
        event_class: determineEventClass(),
        triggered: debug.triggered ? 'true' : 'false',
        suppressed: !debug.triggered && debug.reason !== 'no_trigger' ? 'true' : 'false',
        reason: safeString(debug.reason || 'no_trigger'),
        tesla_location: safeString(debug.conditions?.teslaLocation || 'unknown'),
        user_home: debug.conditions?.userHome ? 'true' : 'false'
    };
}