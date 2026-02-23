/**
 * Rollback InfluxDB Logger
 * Logs push/pop events to InfluxDB measurement `rollback_events`
 *
 * Upstream (rollback-push.ts or rollback-pop.ts) sets:
 *   msg.debug.operation - "push" or "pop"
 *   msg.debug.entityCount - number of entities captured/restored
 *   msg.debug.sceneIds - comma-separated scene entity_ids
 *   msg.debug.ageMs - (pop only) age of rollback entry in ms
 *   msg.debug.timestamp - event timestamp
 */

import { safeNumber, safeString, sanitizeFields } from '../utils/influx-logger-base';

// @ts-ignore - Node-RED global
const message = msg;
const debug = message.debug || {};

const operation = safeString(debug.operation || 'unknown');

message.measurement = 'rollback_events';

const fields = {
    operation,
    entity_count: safeNumber(debug.entityCount || 0),
    scene_ids: safeString(debug.sceneIds || ''),
    age_ms: safeNumber(debug.ageMs || 0),
    timestamp_ms: safeNumber(debug.timestamp || Date.now()),
};

const tags = {
    flow: 'scene_rollback',
    operation,
};

message.payload = [sanitizeFields(fields), tags];
