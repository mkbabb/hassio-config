/**
 * Type definitions for Node-RED message structures used in InfluxDB logging
 */

// Base message structure
interface BaseMessage {
  _msgid?: string;
  topic?: string;
  payload?: any;
  data?: any;
}

// Debug information structures
interface BaseDebugInfo {
  timestamp?: number;
  flowName?: string;
  nodeId?: string;
  executionTime?: number;
}

interface PresenceDebugInfo extends BaseDebugInfo {
  topic: string;
  sensorCount: number;
  coolDownSeconds: number;
  actualDelayMs: number;
  stateTransition: string;
  timeSinceLastOn: number | null;
  timeSinceLastOff: number | null;
  prevState: string;
  prevPrevState: string;
  isOffUnknownOffSequence: boolean;
}

interface CacheDebugInfo extends BaseDebugInfo {
  operation: 'read' | 'write' | 'clear';
  entityCount: number;
  cacheSize: number;
  stateTransition: string;
  timeSinceLastTransition: number;
}

interface ScheduleDebugInfo extends BaseDebugInfo {
  scheduleName: string;
  scheduleType: string;
  precedence: number;
  activeSchedules: number;
  conflictResolved: boolean;
  interpolationPhase?: string;
  tValue?: number;
}

interface BatteryDebugInfo extends BaseDebugInfo {
  checkType: 'scheduled' | 'manual';
  totalDevices: number;
  lowBatteryCount: number;
  criticalBatteryCount: number;
  averageBatteryLevel: number;
}

interface PlantDebugInfo extends BaseDebugInfo {
  scheduleActive: boolean;
  overrideActive: boolean;
  userTriggered: boolean;
  blacklistedCount: number;
  controlledEntities: string[];
}

interface RemoteDebugInfo extends BaseDebugInfo {
  commandType: string;
  commandCount: number;
  deltaChanges: Record<string, any>;
  repeatCount: number;
  controllerUsed: string;
}

// Message type definitions for each flow
interface PresenceMessage extends BaseMessage {
  presenceState?: string;
  aggregateState?: string;
  presenceStates?: Record<string, string>;
  inCoolDown?: boolean;
  entities?: Array<{ entity_id: string }>;
  debug?: PresenceDebugInfo;
}

interface CacheMessage extends BaseMessage {
  state?: 'home' | 'away' | 'unknown';
  action?: string;
  cachedStates?: any[];
  trigger?: string;
  debug?: CacheDebugInfo;
}

interface ScheduleMessage extends BaseMessage {
  schedule?: {
    name?: string;
    type?: string;
    precedence?: number;
    isActive?: boolean;
    t?: number;
  };
  entity?: {
    entity_id?: string;
    state?: string;
  };
  debug?: ScheduleDebugInfo;
}

interface BatteryMessage extends BaseMessage {
  entity?: {
    entity_id?: string;
    state?: string;
    attributes?: {
      battery_level?: number;
      friendly_name?: string;
      device_class?: string;
    };
  };
  alert_sent?: boolean;
  debug?: BatteryDebugInfo;
}

interface PlantMessage extends BaseMessage {
  entity?: {
    entity_id?: string;
    state?: string;
  };
  schedule?: {
    active?: boolean;
    name?: string;
    start?: string;
    end?: string;
  };
  staticState?: Record<string, string>;
  user_triggered?: boolean;
  blacklisted?: boolean;
  debug?: PlantDebugInfo;
}

interface RemoteMessage extends BaseMessage {
  payload?: {
    target?: {
      entity_id?: string;
    };
    service?: string;
    commands?: any[];
  };
  entity_state?: {
    before?: string;
    after?: string;
  };
  controller_id?: string;
  execution_time?: number;
  debug?: RemoteDebugInfo;
}

// InfluxDB payload structure
interface InfluxPayload {
  measurement: string;
  fields: Record<string, any>;
  tags: Record<string, string>;
}

// Export all types
export {
  BaseMessage,
  BaseDebugInfo,
  PresenceMessage,
  PresenceDebugInfo,
  CacheMessage,
  CacheDebugInfo,
  ScheduleMessage,
  ScheduleDebugInfo,
  BatteryMessage,
  BatteryDebugInfo,
  PlantMessage,
  PlantDebugInfo,
  RemoteMessage,
  RemoteDebugInfo,
  InfluxPayload
};