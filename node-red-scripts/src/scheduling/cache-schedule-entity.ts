import { timeStringToDate, compareTime } from "../utils/utils";

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
let entityId = msg.data.entity_id;

const entityTime = timeStringToDate(payload);

// @ts-ignore
node.status({ fill: "blue", shape: "dot", text: entityId });

// If the current day status is "night" and the entity is "sensor.sleep_time"
// Or if the current day status is "day" and the entity is "sensor.wakeup_time"
// OR if the current time is after entity's time

// Then don't change the cached time
const shouldSkip =
    // @ts-ignore
    msg?.should_skip ||
    (dayStatus === "night" && entityId === sleepEntityId) ||
    (dayStatus === "day" && entityId === wakeupEntityId) ||
    compareTime(entityTime, now) < 0;

if (shouldSkip) {
    // @ts-ignore
    msg.time_string = null;
    // @ts-ignore
    msg.payload = null;
    // @ts-ignore
    node.status({ fill: "yellow", shape: "ring", text: `Skip: ${entityId}` });
} else {
    if (entityId === sleepEntityId) {
        // @ts-ignore
        entityId = isWeekend ? weekendSleepEntityId : weekdaySleepEntityId;
    } else if (entityId === wakeupEntityId) {
        entityId = isWeekend ? weekendWakeEntityId : weekdayWakeEntityId;
    }

    if (cachedTimes[entityId] == null) {
        cachedTimes[entityId] = payload;
    }

    const timeString = now.getHours() + ":" + now.getMinutes();

    // @ts-ignore
    msg.time_string = timeString;
    // @ts-ignore
    msg.payload = entityId;

    // @ts-ignore
    node.status({
        fill: "green",
        shape: "dot",
        text: `${entityId.split(".")[1]} (${timeString})`
    });
}
