/**
 * Scheduling InfluxDB Logger
 * Logs schedule executions and entity state changes
 */

import { safeNumber, safeString, safeBooleanAsInt, sanitizeFields } from '../utils/influx-logger-base';

// @ts-ignore - Node-RED global
const message = msg;
const debug = message.debug || {};

// Extract schedule and entity info
const schedule = message.schedule || {};
const entity = message.entity || {};
const action = message.payload || {};

// Set measurement name
message.measurement = 'schedule_events';

// Create comprehensive metrics with type safety
const fields = {
  // Schedule details
  schedule_name: safeString(debug.scheduleName || schedule.name || 'unknown'),
  schedule_type: safeString(debug.scheduleType || schedule.type || 'continuous'),
  precedence: safeNumber(debug.precedence || schedule.precedence || 0),
  
  // Entity info
  entity_id: safeString(entity.entity_id || action.target?.entity_id || 'unknown'),
  current_state: safeString(entity.state || 'unknown'),
  target_state: safeString(action.data?.state || 'unknown'),
  
  // Schedule metrics (ensure all are numbers)
  active_schedules: safeNumber(debug.activeSchedules || 0),
  conflict_resolved: safeBooleanAsInt(debug.conflictResolved),
  entities_processed: safeNumber(debug.entitiesProcessed || 0),
  
  // Interpolation data
  interpolation_phase: safeString(debug.interpolationPhase || 'none'),
  t_value: safeNumber(debug.tValue || schedule.t || 0),
  is_active: safeBooleanAsInt(schedule.isActive),
  
  // Timing
  execution_time: safeNumber(debug.executionTime || 0)
};

// Sanitize and set payload
message.payload = [sanitizeFields(fields)];

// Add tags for filtering
message.tags = {
  flow: 'scheduling',
  schedule_name: debug.scheduleName || schedule.name || 'unknown',
  schedule_type: debug.scheduleType || schedule.type || 'unknown',
  entity_domain: entity.entity_id ? entity.entity_id.split('.')[0] : 'unknown',
  event_type: 'schedule_execution'
};