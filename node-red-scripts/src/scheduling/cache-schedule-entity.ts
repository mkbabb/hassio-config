/**
 * Cache Schedule Entity
 *
 * Conditionally sets datetime entities to current EST time based on day status.
 *
 * Skip Rules:
 * - Day + wake entity + entity_value < current_time → skip (already past wake time)
 * - Day + plants_global_start + entity_value < current_time → skip (already past start time)
 * - All other cases → set entity to current time
 */

import { compareTime, getCurrentTimeString, isWeekday, timeStringToDate } from "../utils/datetime";
import { getEntity } from "../utils/entities";

// Entity constants
const WEEKDAY_WAKE = "input_datetime.weekday_wakeup";
const WEEKEND_WAKE = "input_datetime.weekend_wakeup";
const WEEKDAY_SLEEP = "input_datetime.weekday_sleep";
const WEEKEND_SLEEP = "input_datetime.weekend_sleep";
const WAKE_SENSOR = "sensor.wakeup_time";
const SLEEP_SENSOR = "sensor.sleep_time";
const PLANTS_GLOBAL_START = "input_datetime.plants_global_schedule_start";

interface NodeRedMessage {
	payload: any;
	data?: any;
	entity_id?: string;
	day_status?: "day" | "night";
	time_string?: string | null;
	should_skip?: boolean;
}

/**
 * Check if entity is wake-related
 */
function isWakeEntity(entityId: string): boolean {
	return entityId === WAKE_SENSOR;
}

/**
 * Map sensor to target input_datetime entity based on weekday/weekend
 */
function getTargetEntity(entityId: string): string {
	const weekday = isWeekday();

	if (entityId === WAKE_SENSOR) {
		return weekday ? WEEKDAY_WAKE : WEEKEND_WAKE;
	}

	if (entityId === SLEEP_SENSOR) {
		return weekday ? WEEKDAY_SLEEP : WEEKEND_SLEEP;
	}

	// Plants or direct entity reference
	return entityId;
}

/**
 * Determine if we should skip updating the entity
 *
 * Skip conditions:
 * - Day status + wake entity + entity_value < current_time
 * - Day status + plants entity + entity_value < current_time
 */
function shouldSkipUpdate(
	entityId: string,
	targetEntity: string,
	dayStatus: "day" | "night" | undefined,
	currentTime: string
): { skip: boolean; reason: string } {
	// Only apply skip logic during day status for wake and plants entities
	if (dayStatus !== "day") {
		return { skip: false, reason: "" };
	}

	const isWake = isWakeEntity(entityId);
	const isPlants = entityId === PLANTS_GLOBAL_START;

	if (!isWake && !isPlants) {
		return { skip: false, reason: "" };
	}

	// Get current entity value
	const entity = getEntity(targetEntity);
	if (!entity || !entity.state) {
		return { skip: false, reason: "" };
	}

	const entityValue = entity.state.substring(0, 5); // HH:MM format

	// Compare times: skip if entity value < current time (already past)
	const currentDate = timeStringToDate(currentTime);
	const entityDate = timeStringToDate(entityValue);

	// If current > entity (i.e., entity < current), we're past the time, skip
	if (compareTime(currentDate, entityDate) > 0) {
		const type = isWake ? "wake" : "plants";
		return {
			skip: true,
			reason: `${type} ${entityValue} < current ${currentTime}`,
		};
	}

	return { skip: false, reason: "" };
}

// Main execution
// @ts-ignore
const message: NodeRedMessage = msg;

const inboundEntityId = message.data?.entity_id || message.payload?.entity_id || message.entity_id;

if (!inboundEntityId) {
	// @ts-ignore
	node.status({ fill: "red", shape: "ring", text: "Missing entity_id" });
	message.payload = null;
	message.time_string = null;
	message.should_skip = true;
} else {
	const currentTime = getCurrentTimeString();
	const targetEntity = getTargetEntity(inboundEntityId);
	const skipCheck = shouldSkipUpdate(inboundEntityId, targetEntity, message.day_status, currentTime);

	if (skipCheck.skip) {
		message.payload = null;
		message.time_string = null;
		message.should_skip = true;
		// @ts-ignore
		node.status({ fill: "yellow", shape: "ring", text: `SKIP: ${skipCheck.reason}` });
	} else {
		message.payload = targetEntity;
		message.time_string = currentTime;
		message.should_skip = false;
		// @ts-ignore
		node.status({ fill: "green", shape: "dot", text: `SET ${targetEntity} → ${currentTime}` });
	}
}
