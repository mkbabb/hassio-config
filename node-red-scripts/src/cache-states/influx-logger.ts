/**
 * Cache States InfluxDB Logger
 * Logs home/away transitions and state caching events
 *
 * Upstream (cache-house-state.ts) sets:
 *   msg.entities - entity map
 *   msg.cachedStates - service call array
 *   msg.payload - grouped away actions
 *   msg.state - "home" or "away" (from home-status debouncer, may be undefined)
 */

import { safeNumber, safeString, sanitizeFields } from '../utils/influx-logger-base';

// @ts-ignore - Node-RED global
const message = msg;
const debug = message.debug || {};

const eventType = safeString(message.state || 'unknown');
const isHome = eventType === 'home';
const isAway = eventType === 'away';

// Prefer cachedStates for entity count (payload gets transformed to actions)
const entityCount = safeNumber(
    debug.entityCount || (Array.isArray(message.cachedStates) ? message.cachedStates.length : 0)
);
const cacheSize = safeNumber(
    debug.cacheSize || (message.cachedStates ? message.cachedStates.length : 0)
);

message.measurement = 'cache_events';

const fields = {
    operation: safeString(debug.operation || 'unknown'),
    state: eventType,
    action: safeString(message.action || 'none'),
    entity_count: entityCount,
    cache_size: cacheSize,
    is_home: isHome ? 1 : 0,
    is_away: isAway ? 1 : 0,
    state_transition: safeString(debug.stateTransition || eventType),
    time_since_transition: safeNumber(debug.timeSinceLastTransition || 0),
    execution_time: safeNumber(debug.executionTime || 0),
    timestamp_ms: safeNumber(Date.now())
};

const tags = {
    flow: 'cache_states',
    event_type: eventType,
    operation: safeString(debug.operation || 'unknown'),
    trigger: safeString(message.trigger || 'manual')
};

message.payload = [sanitizeFields(fields), tags];
