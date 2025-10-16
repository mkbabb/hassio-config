/**
 * Battery InfluxDB Logger
 * Logs battery levels and low battery alerts
 */

// @ts-ignore - Node-RED global
const message = msg;
const debug = message.debug || {};

// Helper function to safely convert to number
const safeNumber = (value: any, defaultValue = 0): number => {
  if (value === null || value === undefined || value === '') return defaultValue;
  if (typeof value === 'number') {
    return isNaN(value) ? defaultValue : value;
  }
  if (typeof value === 'string') {
    const parsed = parseFloat(value);
    return isNaN(parsed) ? defaultValue : parsed;
  }
  if (typeof value === 'boolean') return value ? 1 : 0;
  return defaultValue;
};

// Extract battery info
const entity = message.entity || message.data || {};
const batteryLevel = safeNumber(entity.state || entity.attributes?.battery_level, 0);
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

  // Debug metrics from main function - ensure all numbers are safe
  check_type: debug.checkType || 'unknown',
  total_devices: safeNumber(debug.totalDevices, 0),
  low_battery_count: safeNumber(debug.lowBatteryCount, 0),
  critical_battery_count: safeNumber(debug.criticalBatteryCount, 0),
  average_battery_level: safeNumber(debug.averageBatteryLevel, batteryLevel),

  // Timing
  execution_time: safeNumber(debug.executionTime, 0),
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