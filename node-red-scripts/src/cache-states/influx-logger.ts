/**
 * Cache States InfluxDB Logger
 * Logs home/away transitions and state caching events
 */

// @ts-ignore - Node-RED global
const message = msg;
const debug = message.debug || {};

// Determine event type and counts
const eventType = message.state || 'unknown';
const isHome = eventType === 'home';
const isAway = eventType === 'away';

// Use debug info when available, fallback to computed values
const entityCount = debug.entityCount || (Array.isArray(message.payload) ? message.payload.length : 0);
const cacheSize = debug.cacheSize || (message.cachedStates ? message.cachedStates.length : 0);

// Set measurement name
message.measurement = 'cache_events';

// Create payload with comprehensive metrics
message.payload = [{
  // Operation details
  operation: debug.operation || 'unknown',
  state: eventType,
  action: message.action || 'none',
  
  // Counts
  entity_count: entityCount,
  cache_size: cacheSize,
  
  // State flags
  is_home: isHome ? 1 : 0,
  is_away: isAway ? 1 : 0,
  
  // Transition info
  state_transition: debug.stateTransition || eventType,
  time_since_transition: debug.timeSinceLastTransition || 0,
  
  // Timing
  execution_time: debug.executionTime || 0,
  timestamp_ms: Date.now()
}];

// Add tags for filtering
message.tags = {
  flow: 'cache_states',
  event_type: eventType,
  operation: debug.operation || 'unknown',
  trigger: message.trigger || 'manual'
};