/**
 * Scheduling InfluxDB Logger
 * Logs schedule executions and entity state changes
 *
 * Reads from the schedule engine's actual output:
 *   msg.debug = {
 *     schedulesFound, entitiesChecked, actionsGenerated, actionsSkipped,
 *     currentTime, activeSchedules: [{name, type, startTime, endTime}],
 *     skippedActions: [{entity_id, schedule, reason, action}]
 *   }
 *   msg.entityScheduleMatches = [{entity_id, schedule, active, precedence}]
 *   msg.payload = grouped actions array
 */

import { safeNumber, safeString, safeBooleanAsInt, sanitizeFields } from '../utils/influx-logger-base';

// @ts-ignore - Node-RED global
const message = msg;
const debug = message.debug || {};
const entityMatches: any[] = message.entityScheduleMatches || [];
const actions: any[] = Array.isArray(message.payload) ? message.payload : [];

// Set measurement name
message.measurement = 'schedule_events';

// Build the active schedules summary string
const activeSchedules: any[] = Array.isArray(debug.activeSchedules)
    ? debug.activeSchedules
    : [];
const activeScheduleNames = activeSchedules.map((s: any) => s.name).join(',');

// Build fields from actual engine output
const fields = {
    // Summary metrics
    schedules_found: safeNumber(debug.schedulesFound || 0),
    entities_checked: safeNumber(debug.entitiesChecked || 0),
    actions_generated: safeNumber(debug.actionsGenerated || 0),
    actions_skipped: safeNumber(debug.actionsSkipped || 0),
    active_schedule_count: safeNumber(activeSchedules.length),
    active_schedule_names: safeString(activeScheduleNames || 'none'),
    current_time: safeString(debug.currentTime || 'unknown'),

    // Per-entity match details (JSON for querying)
    entity_matches: safeString(
        entityMatches.length > 0
            ? JSON.stringify(entityMatches.slice(0, 20))
            : '[]'
    ),
    entity_match_count: safeNumber(entityMatches.length),

    // Action details
    action_count: safeNumber(actions.length),
    action_targets: safeString(
        actions
            .map((a: any) => {
                const ids = a.target?.entity_id;
                return Array.isArray(ids) ? ids.join(',') : (ids || 'unknown');
            })
            .join(';')
        || 'none'
    ),

    // Skipped actions
    skipped_actions: safeString(
        Array.isArray(debug.skippedActions)
            ? JSON.stringify(debug.skippedActions.slice(0, 10))
            : 'none'
    ),

    // Timing
    timestamp_ms: safeNumber(Date.now())
};

// Add tags for filtering
const tags = {
    flow: 'scheduling',
    active_schedule_count: String(activeSchedules.length),
    has_actions: actions.length > 0 ? 'true' : 'false',
    event_type: 'schedule_execution'
};

// Sanitize and set payload with tags as second element (influxdb 1.x format)
message.payload = [sanitizeFields(fields), tags];
