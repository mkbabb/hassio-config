/**
 * Plants InfluxDB Logger
 * Logs grow light schedules and state changes
 */

// @ts-ignore - Node-RED global
const message = msg;
const debug = message.debug || {};

// Extract plant/grow light info
const entity = message.entity || message.data || {};
const schedule = message.schedule || {};
const staticState = message.staticState || {};

// Set measurement
message.measurement = 'plant_events';

// Create payload with comprehensive metrics
message.payload = [{
  // Entity state
  entity_id: entity.entity_id || 'unknown',
  current_state: entity.state || 'unknown',
  static_state: staticState[entity.entity_id] || 'unknown',
  
  // Schedule info
  schedule_active: schedule.active ? 1 : 0,
  schedule_name: schedule.name || 'none',
  schedule_start: schedule.start || '',
  schedule_end: schedule.end || '',
  
  // Control info
  user_triggered: message.user_triggered ? 1 : 0,
  blacklisted: message.blacklisted ? 1 : 0,
  
  // Debug metrics from main function
  schedule_active_debug: debug.scheduleActive ? 1 : 0,
  override_active: debug.overrideActive ? 1 : 0,
  user_triggered_debug: debug.userTriggered ? 1 : 0,
  blacklisted_count: debug.blacklistedCount || 0,
  controlled_entities_count: debug.controlledEntities?.length || 0,
  
  // Timing
  execution_time: debug.executionTime || 0,
  timestamp_ms: Date.now()
}];

// Add tags for filtering
message.tags = {
  flow: 'plants',
  entity_id: entity.entity_id || 'unknown',
  entity_type: entity.entity_id ? (entity.entity_id.includes('grow') ? 'grow_light' : 'other') : 'unknown',
  event_type: message.event_type || 'state_change',
  schedule_name: schedule.name || 'none'
};