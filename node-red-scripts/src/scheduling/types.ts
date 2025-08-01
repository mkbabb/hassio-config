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

// Common states for different domains
export const DomainStates = {
    light: { on: "on", off: "off" },
    switch: { on: "on", off: "off" },
    fan: { on: "on", off: "off" },
    lock: { on: "locked", off: "unlocked" },
    cover: { on: "open", off: "closed" },
    media_player: { on: "playing", off: "off" },
    climate: { on: "heat", off: "off" },
    vacuum: { on: "cleaning", off: "docked" },
    person: { on: "home", off: "not_home" },
    device_tracker: { on: "home", off: "not_home" },
    binary_sensor: { on: "on", off: "off" },
    input_boolean: { on: "on", off: "off" },
    input_select: { on: "on", off: "off" }  // Will be overridden by schedule states
} as const;

export type DomainStateKey = keyof typeof DomainStates;

export type Schedule = {
    name: string;
    entities?: EntityMatch[];
    tags?: string[];
    start: string | { entity_id: string };
    end?: string | { entity_id: string };  // Optional for trigger schedules
    precedence: number;
    type?: "continuous" | "trigger";  // Default to "trigger"
    conditions?: ScheduleCondition[];
    interpolation?: {
        enabled?: boolean;
        preamble_minutes?: number;
        postamble_minutes?: number;
        events?: boolean;
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
    precedence: number;
    startTime?: string;
    endTime?: string;
    conditions?: ScheduleCondition[];
    interpolation?: {
        enabled?: boolean;
        preamble_minutes?: number;
        postamble_minutes?: number;
        events?: boolean;
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