/**
 * Battery InfluxDB Logger
 * Logs battery levels and low battery alerts
 *
 * Upstream (battery.ts) sets:
 *   msg.payload = { batteryEntities: [...], notification: {...} }
 *   msg.batteryReport = { entities, total, lowCount }
 */

import { safeNumber, safeString, sanitizeFields } from '../utils/influx-logger-base';

// @ts-ignore - Node-RED global
const message = msg;
const batteryEntities: any[] = message.payload?.batteryEntities || [];
const report = message.batteryReport || {};

const lowBatteries = batteryEntities.filter((e: any) => e.state < 30);
const criticalBatteries = batteryEntities.filter((e: any) => e.state < 15);

message.measurement = 'battery_events';

const fields = {
    total_devices: safeNumber(report.total || batteryEntities.length),
    low_battery_count: safeNumber(report.lowCount || lowBatteries.length),
    critical_battery_count: safeNumber(criticalBatteries.length),
    lowest_battery_level: safeNumber(batteryEntities[0]?.state ?? 100),
    lowest_battery_entity: safeString(batteryEntities[0]?.entity_id || 'none'),
    battery_summary: safeString(
        batteryEntities.slice(0, 10).map((e: any) => `${e.entity_id}:${e.state}%`).join(',')
    ),
    timestamp_ms: safeNumber(Date.now())
};

const tags = {
    flow: 'batteries',
    status: criticalBatteries.length > 0 ? 'critical' : lowBatteries.length > 0 ? 'low' : 'normal',
    event_type: 'battery_check'
};

message.payload = [sanitizeFields(fields), tags];
