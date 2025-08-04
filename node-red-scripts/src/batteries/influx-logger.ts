/**
 * Battery InfluxDB Logger
 * Logs battery levels and low battery alerts
 */

// @ts-ignore - Node-RED global
const message = msg;
const debug = message.debug || {};

// Extract battery info
const entity = message.entity || message.data || {};
const batteryLevel = parseInt(entity.state || entity.attributes?.battery_level || 0);
const friendlyName = entity.attributes?.friendly_name || entity.entity_id || 'unknown';

// Determine thresholds
const isLow = batteryLevel < 30;
const isCritical = batteryLevel < 15;

// Set measurement
message.measurement = 'battery_events';

// Create payload with comprehensive metrics
message.payload = [{
  // Battery metrics
  battery_level: batteryLevel,
  is_low: isLow ? 1 : 0,
  is_critical: isCritical ? 1 : 0,
  
  // Entity info
  entity_id: entity.entity_id || 'unknown',
  friendly_name: friendlyName,
  
  // Alert status
  alert_sent: message.alert_sent ? 1 : 0,
  
  // Debug metrics from main function
  check_type: debug.checkType || 'unknown',
  total_devices: debug.totalDevices || 0,
  low_battery_count: debug.lowBatteryCount || 0,
  critical_battery_count: debug.criticalBatteryCount || 0,
  average_battery_level: debug.averageBatteryLevel || batteryLevel,
  
  // Timing
  execution_time: debug.executionTime || 0,
  timestamp_ms: Date.now()
}];

// Add tags for filtering
message.tags = {
  flow: 'batteries',
  entity_id: entity.entity_id || 'unknown',
  device_class: entity.attributes?.device_class || 'battery',
  status: isCritical ? 'critical' : (isLow ? 'low' : 'normal'),
  check_type: debug.checkType || 'manual'
};