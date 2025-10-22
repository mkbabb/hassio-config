/**
 * Schedule processing strategies
 *
 * Implements different schedule types:
 * - Continuous: Enforces state throughout active period
 * - Trigger: Fires once at start and once at end
 */

import { isWithinWindow } from "../../utils/datetime";
import { determineEntityAction } from "./state-mapping";
import type { NormalizedSchedule, NormalizedEntityConfig } from "../types";

/**
 * Processes continuous schedule - enforces state throughout active period
 *
 * @param entity - Entity to control
 * @param schedule - Schedule configuration
 * @param entityConfig - Entity-specific settings
 * @param isActive - Whether in active time window
 * @returns Service call to enforce correct state
 */
export function processContinuousSchedule(
    entity: Hass.State,
    schedule: NormalizedSchedule,
    entityConfig: NormalizedEntityConfig | null,
    isActive: boolean
): Partial<Hass.Service> | null {
    // Continuous: Always enforce state during active period
    return determineEntityAction(entity, schedule, entityConfig, isActive);
}

/**
 * Processes trigger schedule - fires once at start and once at end
 *
 * @param entity - Entity to control
 * @param schedule - Schedule configuration
 * @param entityConfig - Entity-specific settings
 * @param now - Current time
 * @param triggeredSchedules - State tracking for fired triggers
 * @returns Action to execute and whether trigger state was updated
 */
export function processTriggerSchedule(
    entity: Hass.State,
    schedule: NormalizedSchedule,
    entityConfig: NormalizedEntityConfig | null,
    now: Date,
    triggeredSchedules: Record<string, any>
): { action: Partial<Hass.Service> | null; updateTriggerState: boolean } {
    const scheduleKey = `${schedule.name}_${entity.entity_id}`;
    const triggerState: { on: string | null; off: string | null } =
        triggeredSchedules[scheduleKey] || { on: null, off: null };

    const triggerWindowMs = 10 * 60 * 1000; // 10 minutes

    // Use datetime utilities for window checking
    const inStartWindow = isWithinWindow(now, schedule.start, triggerWindowMs);
    const inEndWindow = isWithinWindow(now, schedule.end, triggerWindowMs);
    const pastEndWindow = now.getTime() > (schedule.end.getTime() + triggerWindowMs);

    let action: Partial<Hass.Service> | null = null;
    let updateTriggerState = false;

    // Handle ON trigger: trigger within start window
    if (inStartWindow && !triggerState.on) {
        action = determineEntityAction(entity, schedule, entityConfig, true);
        if (action) {
            triggerState.on = now.toISOString();
            triggeredSchedules[scheduleKey] = triggerState;
            updateTriggerState = true;
        }
    }

    // Handle OFF trigger: trigger within end window
    if (inEndWindow && !triggerState.off) {
        const offAction = determineEntityAction(entity, schedule, entityConfig, false);
        if (offAction) {
            // If we already have an ON action, OFF takes precedence in same cycle
            action = offAction;
            triggerState.off = now.toISOString();
            triggeredSchedules[scheduleKey] = triggerState;
            updateTriggerState = true;
        }
    }

    // Reset state when we're past the schedule for next cycle
    // Only reset if we've passed the end window AND both triggers have fired
    if (pastEndWindow && triggerState.on && triggerState.off) {
        delete triggeredSchedules[scheduleKey];
        updateTriggerState = true;
    }

    return { action, updateTriggerState };
}
