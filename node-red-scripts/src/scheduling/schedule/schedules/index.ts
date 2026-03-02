// Import types from separate file
import type {
    Schedule,
    RegistrySchedule,
    ScheduleRegistry
} from "../../types";
import { restoreDynamicSchedules } from "../../api/registry";
import { plantSchedules } from "./plants-schedules";
import { dayNightSchedules } from "./day-night-schedules";
import { blindsSchedules } from "./blinds-schedules";
import { lockSchedules } from "./lock-schedules";

// Combine all schedules from separate modules
const staticSchedules: Schedule[] = [
    ...dayNightSchedules,
    ...plantSchedules,
    ...blindsSchedules,
    ...lockSchedules
];

// Tag definitions for entity matching
const tagDefinitions = {
    plants: [".*grow.*"],
    bedroom_plants: [".*bedroom.*grow.*", ".*master.*grow.*"],
    warocqueanum: ["light\.titanic_light"],
};

// Seed registry (idempotent upsert: preserves dynamic schedules and enabled toggles)
// @ts-ignore
const existing: ScheduleRegistry | undefined = global.get("scheduleRegistry");
const now = new Date().toISOString();

const registry: ScheduleRegistry = existing ?? {
    version: 1,
    schedules: {},
    tagDefinitions: {},
    lastSeeded: null
};

// Upsert static schedules — preserve enabled toggle if already set
for (const schedule of staticSchedules) {
    const prev = registry.schedules[schedule.name];
    const registrySchedule: RegistrySchedule = {
        ...schedule,
        source: "static",
        enabled: prev?.source === "static" ? prev.enabled : true,
        createdAt: prev?.createdAt ?? now,
        updatedAt: now,
        helperEntities: prev?.helperEntities
    };
    registry.schedules[schedule.name] = registrySchedule;
}

// Remove stale static schedules no longer in the source list
const staticNames = new Set(staticSchedules.map(s => s.name));
for (const [name, sched] of Object.entries(registry.schedules)) {
    if (sched.source === "static" && !staticNames.has(name)) {
        delete registry.schedules[name];
    }
}

// Always update tag definitions and lastSeeded
registry.tagDefinitions = tagDefinitions;
registry.lastSeeded = now;

// @ts-ignore
global.set("scheduleRegistry", registry);

// Restore dynamic schedules from file-backed persistence (survives restarts)
const restoredCount = restoreDynamicSchedules();
