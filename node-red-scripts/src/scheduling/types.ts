// Types for our schedule system

// Global configuration
export const PRESENCE_STATE_ENTITY_ID = "input_select.home_status";
export type EntityMatch = string | RegExp | string[] | RegExp[] | EntityConfig;

export type EntityConfig = {
    entity_id: string | RegExp | string[] | RegExp[];
    states?: {
        on?: EntityState;
        off?: EntityState;
    };
};

// Entity state configuration that can handle any domain
export type EntityState = {
    state?: string;  // The actual state value (e.g., "on", "locked", "home")
    service?: string;  // Override service name
    domain?: string;  // Override domain
    data?: Record<string, any>;  // Additional service data
};

// Re-export domain states from service-calls for schedule type checking
export { DOMAIN_STATES, type DomainStateKey } from "../utils/service-calls";

export type Schedule = {
    name: string;
    entities?: EntityMatch[];
    tags?: string[];
    start: string | { entity_id: string };
    end?: string | { entity_id: string };  // Optional for trigger schedules
    precedence: number;
    type?: "continuous" | "trigger";  // Default to "trigger"
    durationModifier?: number; // 0-1, shrinks window centered (0.5 = 50% duration)
    conditions?: ScheduleCondition[];
    clearStaticOnTransition?: boolean; // Clear external static states on schedule active→inactive or inactive→active transition
    interpolation?: {
        enabled?: boolean;
        preamble_minutes?: number;
        postamble_minutes?: number;
        events?: boolean;
        entities?: string[];  // Entity IDs or "regex:..." patterns for interpolation
    };
    // Default states for entities in this schedule (can be overridden per entity)
    defaultStates?: {
        on?: EntityState;
        off?: EntityState;
    };
};

export type ScheduleCondition = {
    type: "presence" | "state";
    value: string;
    entity_id?: string;
};

export type NormalizedSchedule = {
    name: string;
    entities?: NormalizedEntityConfig[];
    tags?: string[];
    start: Date;
    end: Date;
    type: "continuous" | "trigger";
    durationModifier?: number;
    precedence: number;
    startTime?: string;
    endTime?: string;
    conditions?: ScheduleCondition[];
    interpolation?: {
        enabled?: boolean;
        preamble_minutes?: number;
        postamble_minutes?: number;
        events?: boolean;
        entities?: string[];
    };
    defaultStates?: {
        on?: EntityState;
        off?: EntityState;
    };
};

export type NormalizedEntityConfig = {
    pattern: RegExp;
    states?: {
        on?: EntityState;
        off?: EntityState;
    };
};

export type ScheduleEvent = {
    schedule: string;
    type: "active" | "inactive" | "ramp_up" | "ramp_down_before_end" | "ramp_down";
    t: number;  // 0-1 interpolation value
    time: Date;
    phase?: "sunrise" | "active" | "sunset_prep" | "sunset" | "inactive";
    entity_id?: string;  // Optional entity this event applies to
};

// Registry types for runtime schedule management

export type ScheduleSource = "static" | "dynamic";

export interface RegistrySchedule extends Schedule {
    source: ScheduleSource;
    enabled: boolean;
    createdAt: string;          // ISO 8601
    updatedAt: string;
    helperEntities?: string[];  // input_datetime entities created for dynamic schedules
}

export interface ScheduleRegistry {
    version: number;            // schema version for future migrations
    schedules: Record<string, RegistrySchedule>;
    tagDefinitions: Record<string, string[]>;
    lastSeeded: string | null;
}