/**
 * Base InfluxDB logging utilities
 * Shared across all flow loggers for consistency
 */

export interface LogEvent {
  measurement: string;
  fields: Record<string, any>;
  tags: Record<string, string>;
}

// Type-safe value conversion for InfluxDB
export const safeNumber = (value: any): number => {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const parsed = parseFloat(value);
    return isNaN(parsed) ? 0 : parsed;
  }
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (Array.isArray(value)) return value.length;
  if (typeof value === 'object' && value !== null) return Object.keys(value).length;
  return 0;
};

export const safeString = (value: any): string => {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return value.toString();
  if (typeof value === 'boolean') return value.toString();
  if (value === null || value === undefined) return 'unknown';
  return String(value);
};

export const safeBooleanAsInt = (value: any): number => {
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (typeof value === 'number') return value > 0 ? 1 : 0;
  if (typeof value === 'string') return value.toLowerCase() === 'true' || value === '1' ? 1 : 0;
  return 0;
};

// Clean field values to prevent InfluxDB parsing errors
export const sanitizeFields = (fields: Record<string, any>): Record<string, any> => {
  const sanitized: Record<string, any> = {};
  
  for (const [key, value] of Object.entries(fields)) {
    // Skip null/undefined values
    if (value === null || value === undefined) {
      continue;
    }
    
    // Convert to appropriate type based on value
    if (typeof value === 'boolean' || key.includes('_flag') || key.includes('is_') || key.includes('conflict_')) {
      sanitized[key] = safeBooleanAsInt(value);
    } else if (typeof value === 'object' && !Array.isArray(value)) {
      // Convert objects to counts or skip
      sanitized[key] = Object.keys(value).length;
    } else {
      sanitized[key] = value;
    }
  }
  
  return sanitized;
};

export function createLogEvent(
  measurement: string,
  fields: Record<string, any>,
  tags: Record<string, string>
): LogEvent {
  return {
    measurement,
    fields: {
      ...sanitizeFields(fields),
      timestamp_ms: Date.now()
    },
    tags: {
      ...tags,
      node_id: msg._msgid || 'unknown'
    }
  };
}

export function formatForInflux(event: LogEvent): any {
  // Set measurement for InfluxDB node
  msg.measurement = event.measurement;
  
  // Format payload for InfluxDB
  msg.payload = [event.fields];
  msg.tags = event.tags;
  
  return msg;
}