/**
 * Cache Schedule Entity
 *
 * Purpose: Cache schedule entity times and set them to current values.
 * This allows preserving and restoring wake/sleep schedules.
 *
 * Entity Types:
 * 1. Wake entities (sensor.wakeup_time) - Template sensors that dynamically select:
 *    - input_datetime.weekday_wakeup (Mon-Fri, Python weekday 0-4)
 *    - input_datetime.weekend_wakeup (Sat-Sun, Python weekday 5-6)
 *
 * 2. Sleep entities (sensor.sleep_time) - Template sensors that dynamically select:
 *    - input_datetime.weekday_sleep (Mon-Fri)
 *    - input_datetime.weekend_sleep (Sat-Sun)
 *
 * 3. Plants global start (input_datetime.plants_global_schedule_start) - Direct entity
 *
 * Skip Logic:
 * - Wake/Plants: Skip if day_status == "day" AND inbound_time > current_time
 *   Example: If it's 11 AM (day) and wake entity is 9 AM, skip (already past)
 *
 * - Sleep: Never skip, but enforce minimum 1-hour gap after wake time
 *   Example: If wake is 8 AM and sleep is set to 8 AM, adjust sleep to 9 AM
 *
 * Week Boundary Logic:
 * - JavaScript getDay(): 0=Sun, 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat
 * - Python weekday(): 0=Mon, 1=Tue, 2=Wed, 3=Thu, 4=Fri, 5=Sat, 6=Sun
 * - Template uses: weekday < 5 for weekday entities
 * - Conversion: pythonWeekday = (jsGetDay() + 6) % 7
 */

import { timeStringToDate, compareTime, dateToTimeString } from "../utils/datetime";
import { getEntity } from "../utils/ha-entities";

// ============================================================================
// Entity ID Constants
// ============================================================================

// Concrete input_datetime entities (what we actually update)
const WEEKDAY_WAKE_ID = "input_datetime.weekday_wakeup";
const WEEKEND_WAKE_ID = "input_datetime.weekend_wakeup";
const WEEKDAY_SLEEP_ID = "input_datetime.weekday_sleep";
const WEEKEND_SLEEP_ID = "input_datetime.weekend_sleep";

// Template sensors (dynamic selectors based on day of week)
const WAKE_SENSOR_ID = "sensor.wakeup_time";
const SLEEP_SENSOR_ID = "sensor.sleep_time";

// Direct entity
const PLANTS_START_ID = "input_datetime.plants_global_schedule_start";

// Minimum gap between wake and sleep times (milliseconds)
const MIN_WAKE_SLEEP_GAP_MS = 60 * 60 * 1000; // 1 hour

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Convert JavaScript getDay() (0=Sun) to Python weekday() (0=Mon)
 * to match Home Assistant template logic
 */
function getPythonWeekday(date: Date): number {
    return (date.getDay() + 6) % 7;
}

/**
 * Determine if we should use weekday or weekend entities
 * Matches HA template: {% if now().weekday() < 5 %}
 */
function isWeekdayContext(date: Date): boolean {
    return getPythonWeekday(date) < 5; // Mon-Fri = 0-4
}

/**
 * Get current state value of an entity
 */
function getEntityState(entityId: string): string | null {
    const entity = getEntity(entityId);
    if (!entity || !entity.state || entity.state === 'unavailable' || entity.state === 'unknown') {
        return null;
    }
    return entity.state;
}

// ============================================================================
// Main Logic
// ============================================================================

// @ts-ignore
const message = msg;
const now = new Date();

// Extract input data
const inboundEntityId = message.data?.entity_id || message.payload?.entity_id || message.entity_id;
const inboundTime = message.payload; // Time string like "08:00:00"
const dayStatus = message.day_status; // "day" or "night"

// Validate inputs
if (!inboundEntityId || typeof inboundEntityId !== 'string' || inboundEntityId.trim() === '') {
    // @ts-ignore
    node.status({ fill: "red", shape: "ring", text: "Invalid entity_id" });
    // @ts-ignore
    msg.payload = null;
    // @ts-ignore
    msg.should_skip = true;
} else if (!inboundTime || typeof inboundTime !== 'string') {
    // @ts-ignore
    node.status({ fill: "red", shape: "ring", text: "Invalid time payload" });
    // @ts-ignore
    msg.payload = null;
    // @ts-ignore
    msg.should_skip = true;
} else {
    // Determine week context (weekday vs weekend)
    const useWeekdayEntities = isWeekdayContext(now);

    // Determine entity type and target entity ID
    let entityType: "wake" | "sleep" | "plants" | "unknown" = "unknown";
    let targetEntityId = inboundEntityId;

    if (inboundEntityId === WAKE_SENSOR_ID) {
        entityType = "wake";
        targetEntityId = useWeekdayEntities ? WEEKDAY_WAKE_ID : WEEKEND_WAKE_ID;
    } else if (inboundEntityId === SLEEP_SENSOR_ID) {
        entityType = "sleep";
        targetEntityId = useWeekdayEntities ? WEEKDAY_SLEEP_ID : WEEKEND_SLEEP_ID;
    } else if (inboundEntityId === PLANTS_START_ID) {
        entityType = "plants";
        targetEntityId = PLANTS_START_ID;
    }

    // Get current entity state for comparison
    const currentEntityState = getEntityState(targetEntityId);

    // Parse times
    const inboundTimeDate = timeStringToDate(inboundTime);
    const currentTimeDate = now;

    // Compare inbound time with current time
    // compareTime returns: -1 if time1 < time2, 0 if equal, 1 if time1 > time2
    const timeComparison = compareTime(currentTimeDate, inboundTimeDate);

    // Initialize skip logic
    let shouldSkip = false;
    const skipReasons: string[] = [];
    let finalTime = inboundTime;

    // ========================================================================
    // Skip Logic for Wake and Plants Entities
    // ========================================================================
    if ((entityType === "wake" || entityType === "plants") && dayStatus === "day") {
        // If it's daytime and the wake/plants time is in the future, skip
        // This means we haven't reached the wake time yet, so don't update
        if (timeComparison < 0) { // currentTime < inboundTime
            shouldSkip = true;
            skipReasons.push(`day_status=day, wake_time=${inboundTime} > current=${dateToTimeString(currentTimeDate)}`);
        }
    }

    // ========================================================================
    // Redundancy Check: Skip if setting same value
    // ========================================================================
    if (!shouldSkip && currentEntityState) {
        // Normalize times for comparison (handle HH:MM:SS vs HH:MM)
        const normalizedInbound = inboundTime.substring(0, 5); // Get HH:MM
        const normalizedCurrent = currentEntityState.substring(0, 5);

        if (normalizedInbound === normalizedCurrent) {
            shouldSkip = true;
            skipReasons.push(`already_set_to=${normalizedCurrent}`);
        }
    }

    // ========================================================================
    // Sleep Entity: Enforce Minimum Gap After Wake
    // ========================================================================
    if (!shouldSkip && entityType === "sleep") {
        // Get corresponding wake entity
        const wakeEntityId = useWeekdayEntities ? WEEKDAY_WAKE_ID : WEEKEND_WAKE_ID;
        const wakeTimeStr = getEntityState(wakeEntityId);

        if (wakeTimeStr) {
            const wakeTimeDate = timeStringToDate(wakeTimeStr);
            const minSleepTimeDate = new Date(wakeTimeDate.getTime() + MIN_WAKE_SLEEP_GAP_MS);

            // If inbound sleep time is before minimum allowed time, adjust it
            if (inboundTimeDate < minSleepTimeDate) {
                finalTime = dateToTimeString(minSleepTimeDate);
                // Note: Not skipping, just adjusting the time
            }
        }
    }

    // ========================================================================
    // Cache Management
    // ========================================================================
    // @ts-ignore
    let cachedTimes = flow.get("cachedTimes");
    if (!cachedTimes) {
        cachedTimes = {};
        // @ts-ignore
        flow.set("cachedTimes", cachedTimes);
        // @ts-ignore
        node.status({ fill: "blue", shape: "ring", text: "Cache initialized" });
    }

    if (!shouldSkip) {
        // Update cache with final time
        cachedTimes[targetEntityId] = finalTime;
        // @ts-ignore
        flow.set("cachedTimes", cachedTimes);
    }

    // ========================================================================
    // Output Message
    // ========================================================================
    if (shouldSkip) {
        // @ts-ignore
        msg.payload = null;
        // @ts-ignore
        msg.time_string = null;
        // @ts-ignore
        msg.should_skip = true;
        // @ts-ignore
        node.status({
            fill: "yellow",
            shape: "ring",
            text: `Skip ${entityType}: ${skipReasons.join(", ")}`
        });
    } else {
        // @ts-ignore
        msg.payload = targetEntityId;
        // @ts-ignore
        msg.time_string = finalTime;
        // @ts-ignore
        msg.should_skip = false;
        // @ts-ignore
        node.status({
            fill: "green",
            shape: "dot",
            text: `Set ${entityType} → ${finalTime}`
        });
    }

    // ========================================================================
    // Debug Information
    // ========================================================================
    // @ts-ignore
    msg.debug = {
        inbound_entity_id: inboundEntityId,
        target_entity_id: targetEntityId,
        entity_type: entityType,
        day_status: dayStatus,
        current_time: dateToTimeString(currentTimeDate),
        current_entity_state: currentEntityState,
        inbound_time: inboundTime,
        final_time: finalTime,
        should_skip: shouldSkip,
        skip_reasons: skipReasons,
        week_context: useWeekdayEntities ? "weekday" : "weekend",
        js_day: now.getDay(),
        python_weekday: getPythonWeekday(now),
        time_comparison: timeComparison
    };
}
