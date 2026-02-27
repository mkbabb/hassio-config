/**
 * Schedule Registry - shared read/write utilities for API endpoints
 * Provides safe access to the schedule registry stored in global context.
 *
 * Dynamic schedules are persisted to a JSON file so they survive Node-RED restarts.
 * File: /Volumes/config/dynamic-schedules.json
 */

import type { ScheduleRegistry, RegistrySchedule } from "../types";

const REGISTRY_KEY = "scheduleRegistry";
const PERSISTENCE_PATH = "/Volumes/config/dynamic-schedules.json";

// ─── File-backed persistence for dynamic schedules ───────────────────────────

/**
 * Read persisted dynamic schedules from disk.
 * Returns an empty record if the file doesn't exist or is corrupt.
 */
function loadPersistedSchedules(): Record<string, RegistrySchedule> {
    try {
        // @ts-ignore — Node-RED ships with fs available at runtime
        const fs = require("fs");
        if (!fs.existsSync(PERSISTENCE_PATH)) return {};
        const raw = fs.readFileSync(PERSISTENCE_PATH, "utf-8");
        const data = JSON.parse(raw);
        return data?.schedules ?? {};
    } catch {
        return {};
    }
}

/**
 * Write all dynamic schedules from the registry to disk.
 * Only dynamic schedules are persisted — static ones are reseeded from TS on startup.
 */
function persistDynamicSchedules(registry: ScheduleRegistry): void {
    try {
        const dynamic: Record<string, RegistrySchedule> = {};
        for (const [name, schedule] of Object.entries(registry.schedules)) {
            if (schedule.source === "dynamic") {
                dynamic[name] = schedule;
            }
        }
        const payload = JSON.stringify({ version: 1, schedules: dynamic, savedAt: new Date().toISOString() }, null, 2);
        // @ts-ignore
        const fs = require("fs");
        fs.writeFileSync(PERSISTENCE_PATH, payload, "utf-8");
    } catch {
        // Silently fail — logging would be nice but we're in Node-RED function context
    }
}

/**
 * Get the current schedule registry from global context
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
 * Save the registry back to global context and persist dynamic schedules to disk
 */
export function saveRegistry(registry: ScheduleRegistry): void {
    // @ts-ignore - global is provided by Node-RED
    global.set(REGISTRY_KEY, registry);
    persistDynamicSchedules(registry);
}

/**
 * Load persisted dynamic schedules into the registry.
 * Called once on startup (from seed-registry or an inject node).
 * Preserves any dynamic schedules that were created via the API.
 */
export function restoreDynamicSchedules(): number {
    const registry = getRegistry();
    const persisted = loadPersistedSchedules();
    let restored = 0;

    for (const [name, schedule] of Object.entries(persisted)) {
        // Don't overwrite a schedule that already exists (e.g. if it was re-created)
        if (!registry.schedules[name]) {
            registry.schedules[name] = schedule;
            restored++;
        }
    }

    if (restored > 0) {
        // @ts-ignore
        global.set(REGISTRY_KEY, registry);
    }

    return restored;
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
