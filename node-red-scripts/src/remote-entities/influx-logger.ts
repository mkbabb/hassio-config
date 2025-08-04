/**
 * Remote Entities InfluxDB Logger
 * Logs IR/RF device commands and state changes
 */

// @ts-ignore - Node-RED global
const message = msg;
const debug = message.debug || {};

// Extract remote entity info
const target = message.payload?.target || {};
const service = message.payload?.service || 'unknown';
const commands = message.payload?.commands || [];
const entityState = message.entity_state || {};

// Set measurement
message.measurement = 'remote_events';

// Create payload with comprehensive metrics
message.payload = [{
  // Entity info
  entity_id: target.entity_id || 'unknown',
  service: service,
  command_count: Array.isArray(commands) ? commands.length : 1,
  
  // State tracking
  state_before: entityState.before || 'unknown',
  state_after: entityState.after || 'unknown',
  
  // Device info
  controller_id: message.controller_id || 'unknown',
  device_type: target.entity_id ? target.entity_id.split('.')[0] : 'unknown',
  
  // Command details
  ir_commands: JSON.stringify(commands).substring(0, 500),
  
  // Debug metrics from main function
  command_type: debug.commandType || service,
  command_count_debug: debug.commandCount || 1,
  delta_changes_count: Object.keys(debug.deltaChanges || {}).length,
  repeat_count: debug.repeatCount || 1,
  controller_used: debug.controllerUsed || 'unknown',
  
  // Timing
  execution_time_ms: message.execution_time || debug.executionTime || 0,
  timestamp_ms: Date.now()
}];

// Add tags for filtering
message.tags = {
  flow: 'remote_entities',
  entity_id: target.entity_id || 'unknown',
  service: service,
  device_type: target.entity_id ? target.entity_id.split('.')[0] : 'unknown',
  event_type: 'ir_command',
  controller: debug.controllerUsed || message.controller_id || 'unknown'
};