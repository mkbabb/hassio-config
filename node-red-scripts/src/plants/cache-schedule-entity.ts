const weekdaySleepEntityId = "input_datetime.weekday_sleep";
const weekendSleepEntityId = "input_datetime.weekend_sleep";

const weekdayWakeEntityId = "input_datetime.weekday_wakeup";
const weekendWakeEntityId = "input_datetime.weekend_wakeup";

const sleepEntityId = "sensor.sleep_time";
const wakeupEntityId = "sensor.wakeup_time";

const now = new Date();

const isWeekend = now.getDay() === 0 || now.getDay() === 6;

// @ts-ignore
const payload = msg.payload;

// @ts-ignore
let entityId = msg.data.entity_id;

if (entityId === sleepEntityId) {
    // @ts-ignore
    entityId = isWeekend ? weekendSleepEntityId : weekdaySleepEntityId;
} else if (entityId === wakeupEntityId) {
    entityId = isWeekend ? weekendWakeEntityId : weekdayWakeEntityId;
}

// @ts-ignore
let cachedTimes = flow.get("cachedTimes");
if (cachedTimes == null) {
    // @ts-ignore
    flow.set("cachedTimes", {});
    // @ts-ignore
    cachedTimes = flow.get("cachedTimes");
}

if (cachedTimes[entityId] == null) {
    cachedTimes[entityId] = payload;
}

const timeString = now.getHours() + ":" + now.getMinutes();

// @ts-ignore
msg.time_string = timeString;
// @ts-ignore
msg.payload = entityId;
