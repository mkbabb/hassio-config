/**
 * Validation utilities for schedule actions
 *
 * Provides safety checks before executing scheduled actions:
 * - Battery level validation (skip if ≤2%)
 * - Door open validation for locks
 * - Obstruction validation for covers
 */

import { getEntity, getBatteryLevel } from "./entities";
import { getEntityBasename, getEntityDomain } from "./utils";

// Battery level threshold - skip actions if battery is at or below this level
const BATTERY_MIN_THRESHOLD = 2;

/**
 * Generic function to find a related entity using common naming patterns
 *
 * @param deviceBasename - Basename of the device entity (e.g., "front_door" from "lock.front_door")
 * @param patterns - Array of entity ID patterns to try (use {basename} placeholder)
 * @param validator - Optional function to validate the entity before returning
 * @returns Related entity if found and valid, null otherwise
 */
function findRelatedEntity(
    deviceBasename: string,
    patterns: string[],
    validator?: (entity: Hass.State) => boolean
): Hass.State | null {
    for (const pattern of patterns) {
        const entityId = pattern.replace('{basename}', deviceBasename);
        const entity = getEntity(entityId);

        if (entity && (!validator || validator(entity))) {
            return entity;
        }
    }

    return null;
}

/**
 * Find battery entity for a device using common naming patterns
 *
 * @param deviceBasename - Basename of the device entity (e.g., "front_door" from "lock.front_door")
 * @returns Battery entity if found, null otherwise
 */
function findBatteryEntity(deviceBasename: string): Hass.State | null {
    return findRelatedEntity(
        deviceBasename,
        [
            'sensor.{basename}_battery',
            'sensor.{basename}_battery_state',
            'sensor.{basename}_battery_level',
        ],
        (entity) => getBatteryLevel(entity) !== null
    );
}

/**
 * Find door sensor for a lock using common naming patterns
 *
 * @param lockBasename - Basename of the lock entity (e.g., "front_door" from "lock.front_door")
 * @returns Door sensor entity if found, null otherwise
 */
function findDoorSensor(lockBasename: string): Hass.State | null {
    return findRelatedEntity(
        lockBasename,
        [
            'binary_sensor.{basename}_door',
            'binary_sensor.{basename}_contact',
            'binary_sensor.{basename}_open',
        ]
    );
}

/**
 * Find obstruction sensor for a cover using common naming patterns
 *
 * @param coverBasename - Basename of the cover entity (e.g., "garage_door" from "cover.garage_door")
 * @returns Obstruction sensor entity if found, null otherwise
 */
function findObstructionSensor(coverBasename: string): Hass.State | null {
    return findRelatedEntity(
        coverBasename,
        [
            'binary_sensor.{basename}_obstruction',
            'binary_sensor.{basename}_obstacle',
            'sensor.{basename}_obstruction',
        ]
    );
}

/**
 * Check if action should be skipped due to low battery
 *
 * @param entityId - Entity ID to check
 * @returns true if battery is too low (≤2%), false otherwise
 */
function shouldSkipDueToBattery(entityId: string): boolean {
    // First check if the entity itself has battery info
    const entity = getEntity(entityId);
    if (entity) {
        const directBattery = getBatteryLevel(entity);
        if (directBattery !== null && directBattery <= BATTERY_MIN_THRESHOLD) {
            return true;
        }
    }

    // Then check for separate battery entity
    const basename = getEntityBasename(entityId);
    const batteryEntity = findBatteryEntity(basename);

    if (!batteryEntity) {
        return false; // No battery found, proceed with action
    }

    const batteryLevel = getBatteryLevel(batteryEntity);
    return batteryLevel !== null && batteryLevel <= BATTERY_MIN_THRESHOLD;
}

/**
 * Check if lock action should be skipped due to door being open
 *
 * @param lockEntityId - Lock entity ID to check
 * @returns true if door is open, false otherwise
 */
function shouldSkipLockDueToDoor(lockEntityId: string): boolean {
    const domain = getEntityDomain(lockEntityId);
    if (domain !== "lock") {
        return false;
    }

    const basename = getEntityBasename(lockEntityId);
    const doorSensor = findDoorSensor(basename);

    if (!doorSensor) {
        return false; // No door sensor found, proceed with action
    }

    // Binary sensor states: on = open, off = closed
    return doorSensor.state === "on";
}

/**
 * Check if cover action should be skipped due to obstruction
 *
 * @param coverEntityId - Cover entity ID to check
 * @returns true if obstruction detected, false otherwise
 */
function shouldSkipCoverDueToObstruction(coverEntityId: string): boolean {
    const domain = getEntityDomain(coverEntityId);
    if (domain !== "cover") {
        return false;
    }

    const basename = getEntityBasename(coverEntityId);
    const obstructionSensor = findObstructionSensor(basename);

    if (!obstructionSensor) {
        return false; // No obstruction sensor found, proceed with action
    }

    // Binary sensor: on = obstructed, off = clear
    return obstructionSensor.state === "on";
}

/**
 * Master validation function - checks all safety conditions for a scheduled action
 *
 * @param action - Service call action to validate
 * @returns true if action should be skipped, false if it's safe to proceed
 */
export function shouldSkipAction(action: Partial<Hass.Service>): { skip: boolean; reason?: string } {
    const entityId = action.data?.entity_id;
    if (!entityId) {
        return { skip: false };
    }

    // Check battery level for all battery-powered devices
    if (shouldSkipDueToBattery(entityId)) {
        return { skip: true, reason: "battery_low" };
    }

    // Check door state for lock actions
    if (action.service === "lock" && shouldSkipLockDueToDoor(entityId)) {
        return { skip: true, reason: "door_open" };
    }

    // Check obstruction for cover actions
    if (getEntityDomain(entityId) === "cover" && shouldSkipCoverDueToObstruction(entityId)) {
        return { skip: true, reason: "obstruction_detected" };
    }

    return { skip: false };
}
