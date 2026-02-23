/**
 * Remote Entities InfluxDB Logger
 * Logs IR/RF device commands and state changes
 *
 * Upstream (service-call/index.ts) sets:
 *   msg.payload = [array of remote service calls]
 *   msg.entity_state = JSON.stringify(stateObj)  (string, not object)
 *   msg.entity_state_id = target.entity_state_id (string)
 */

import { safeNumber, safeString, sanitizeFields } from '../utils/influx-logger-base';

// @ts-ignore - Node-RED global
const message = msg;

// payload is an array of service calls, not a single object
const commands: any[] = Array.isArray(message.payload) ? message.payload : [];

// entity_state is a JSON string — parse it safely
const entityState = typeof message.entity_state === 'string'
    ? (() => { try { return JSON.parse(message.entity_state); } catch { return {}; } })()
    : (message.entity_state || {});

// Extract target entity from first command
const firstCmd = commands[0] || {};
const controllerId = safeString(firstCmd?.target?.entity_id || 'unknown');
const device = safeString(firstCmd?.data?.device || 'unknown');

message.measurement = 'remote_events';

const fields = {
    controller_id: controllerId,
    device: device,
    command_count: safeNumber(commands.length),
    commands: safeString(
        commands.map((c: any) => c.data?.command || 'unknown').join(',')
    ),
    entity_state: safeString(JSON.stringify(entityState).substring(0, 500)),
    entity_state_id: safeString(message.entity_state_id || 'unknown'),
    timestamp_ms: safeNumber(Date.now())
};

const tags = {
    flow: 'remote_entities',
    device: device,
    controller: controllerId,
    event_type: 'ir_command'
};

message.payload = [sanitizeFields(fields), tags];
