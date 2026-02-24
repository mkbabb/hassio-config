/**
 * Schedule Registry - shared read/write utilities for API endpoints
 * Provides safe access to the schedule registry stored in global context.
 */

import type { ScheduleRegistry, RegistrySchedule } from "../types";

const REGISTRY_KEY = "scheduleRegistry";

/**
 * Get the current schedule registry from flow context
 */
export function getRegistry(): ScheduleRegistry {
    // @ts-ignore - global is provided by Node-RED
    return global.get(REGISTRY_KEY) ?? {
        version: 1,
        schedules: {},
        tagDefinitions: {},
        lastSeeded: null
    };
}

/**
 * Save the registry back to flow context
 */
export function saveRegistry(registry: ScheduleRegistry): void {
    // @ts-ignore - global is provided by Node-RED
    global.set(REGISTRY_KEY, registry);
}

/**
 * Get a single schedule by name
 */
export function getSchedule(name: string): RegistrySchedule | undefined {
    const registry = getRegistry();
    return registry.schedules[name];
}

/**
 * Get all enabled schedules as a flat array
 */
export function getEnabledSchedules(): RegistrySchedule[] {
    const registry = getRegistry();
    return Object.values(registry.schedules).filter(s => s.enabled);
}

/**
 * Upsert a schedule into the registry
 */
export function upsertSchedule(name: string, schedule: RegistrySchedule): void {
    const registry = getRegistry();
    registry.schedules[name] = schedule;
    saveRegistry(registry);
}

/**
 * Delete a schedule from the registry (only dynamic schedules)
 * Returns true if deleted, false if not found or static
 */
export function deleteSchedule(name: string): { deleted: boolean; reason?: string } {
    const registry = getRegistry();
    const schedule = registry.schedules[name];

    if (!schedule) {
        return { deleted: false, reason: "not_found" };
    }
    if (schedule.source === "static") {
        return { deleted: false, reason: "static_schedule" };
    }

    delete registry.schedules[name];
    saveRegistry(registry);
    return { deleted: true };
}
