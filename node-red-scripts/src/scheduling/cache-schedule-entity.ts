import { timeStringToDate, compareTime, dateToTimeString } from "../utils/datetime";

const weekdaySleepEntityId = "input_datetime.weekday_sleep";
const weekendSleepEntityId = "input_datetime.weekend_sleep";

const weekdayWakeEntityId = "input_datetime.weekday_wakeup";
const weekendWakeEntityId = "input_datetime.weekend_wakeup";

const sleepEntityId = "sensor.sleep_time";
const wakeupEntityId = "sensor.wakeup_time";

const now = new Date();

const isWeekend = now.getDay() === 0 || now.getDay() === 6;

// @ts-ignore
let cachedTimes = flow.get("cachedTimes");
if (cachedTimes == null) {
    // @ts-ignore
    flow.set("cachedTimes", {});
    // @ts-ignore
    cachedTimes = flow.get("cachedTimes");
    // @ts-ignore
    node.status({ fill: "blue", shape: "ring", text: "Cache init" });
}

// @ts-ignore
const payload = msg.payload;

// @ts-ignore
const dayStatus = msg.day_status;

// @ts-ignore
let entityId = msg.data?.entity_id || msg.payload?.entity_id || msg.entity_id;

// Validate entity_id is not empty
if (!entityId || entityId.trim() === "") {
    // @ts-ignore
    node.status({ fill: "red", shape: "ring", text: "Empty entity_id" });
    // @ts-ignore
    msg.should_skip = true;
    entityId = "invalid"; // Set to prevent further processing
}

const entityTime = timeStringToDate(payload);

// @ts-ignore
node.status({ fill: "blue", shape: "dot", text: entityId });

// If the current day status is "night" and the entity is "sensor.sleep_time"
// Or if the current day status is "day" and the entity is "sensor.wakeup_time"
// OR if the current time is after entity's time

// Then don't change the cached time
// Calculate time comparison correctly handling midnight crossover
// If entity time is very early morning (0-3 AM) and current time is late evening (9-11 PM),
// treat entity time as tomorrow
let timeComparison = compareTime(now, entityTime);
const currentHour = now.getHours();
const entityHour = entityTime.getHours();

// Handle midnight edge case: if current is late evening and entity is early morning
if (currentHour >= 21 && entityHour <= 3) {
    timeComparison = -1; // Entity time is tomorrow, not past
}

// Build debug info about skip reasons
const skipReasons: string[] = [];
let shouldSkip = false;

// @ts-ignore
if (msg?.should_skip) {
    skipReasons.push("pre-flagged");
    shouldSkip = true;
}

// REMOVED the day/night skip logic - we want to set schedules for the NEXT occurrence
// The old logic was wrong: during night, we WANT to set tomorrow's sleep time
// During day, we WANT to set tonight's wakeup time

// Only skip if we're truly past the time AND it's not a midnight crossover
// For sleep/wake entities, we're always setting for the next occurrence
const isScheduleEntity = entityId === sleepEntityId || entityId === wakeupEntityId;
if (!isScheduleEntity && timeComparison > 0) {
    // For non-schedule entities, skip if time is past
    skipReasons.push(`time_past(${dateToTimeString(now)}>${dateToTimeString(entityTime)})`);
    shouldSkip = true;
}

// @ts-ignore
msg.debug = {
    entity_id: entityId,
    day_status: dayStatus,
    current_time: dateToTimeString(now),
    entity_time: dateToTimeString(entityTime),
    time_comparison: timeComparison,
    skip_reasons: skipReasons,
    should_skip: shouldSkip,
    is_weekend: isWeekend
};

if (shouldSkip) {
    // @ts-ignore
    msg.time_string = null;
    // @ts-ignore
    msg.payload = null;
    // @ts-ignore
    node.status({
        fill: "yellow",
        shape: "ring",
        text: `Skip ${entityId.split(".")[1]}: ${skipReasons.join(", ")}`
    });
} else {
    // Map sensor entities to the actual input_datetime entities
    let targetEntityId = entityId;
    if (entityId === sleepEntityId) {
        targetEntityId = isWeekend ? weekendSleepEntityId : weekdaySleepEntityId;
    } else if (entityId === wakeupEntityId) {
        targetEntityId = isWeekend ? weekendWakeEntityId : weekdayWakeEntityId;
    }

    if (cachedTimes[targetEntityId] == null) {
        cachedTimes[targetEntityId] = payload;
    }

    const timeString = dateToTimeString(now);

    // @ts-ignore
    msg.time_string = timeString;
    // @ts-ignore
    msg.payload = targetEntityId;  // Use the mapped entity ID, not the original

    // @ts-ignore
    node.status({
        fill: "green",
        shape: "dot",
        text: `${targetEntityId.split(".")[1]} (${timeString})`
    });
}
