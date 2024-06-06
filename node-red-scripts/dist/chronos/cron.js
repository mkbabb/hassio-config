"use strict";
function getEntityBasename(entityId) {
  const match = entityId.match(/^.*\.(.*)$/);
  return match ? match[1] : entityId;
}
function getTimeComponents(time) {
  let timeParts = time.split(":");
  let [hours, mins, seconds] = timeParts.concat(Array(3 - timeParts.length).fill("00")).map((x) => parseInt(x));
  return [hours, mins, seconds];
}
function normalizeTime(time) {
  let [hours, mins, seconds] = getTimeComponents(time);
  return `${hours}:${mins}:${seconds}`;
}
function extractTimeFromPayload(entityId, payload2) {
  const entity = payload2.find((item) => item.entity_id === entityId);
  return entity ? normalizeTime(entity.state) : "00:00:00";
}
function subtractMinutes(time, minutes) {
  let date = /* @__PURE__ */ new Date();
  let [hours, mins, seconds] = getTimeComponents(time);
  date.setHours(hours);
  date.setMinutes(mins - minutes);
  date.setSeconds(seconds);
  return date.toTimeString().split(" ")[0];
}
function createCronEntry(cronExpression) {
  return {
    type: "crontab",
    value: cronExpression
  };
}
function createWeekdayCronEntry(time) {
  const [hours, minutes, seconds] = getTimeComponents(time);
  return `${seconds} ${minutes} ${hours} * * 1-5`;
}
function createWeekendCronEntry(time) {
  const [hours, minutes, seconds] = getTimeComponents(time);
  return `${seconds} ${minutes} ${hours} * * 0,6`;
}
const payload = msg.payload.sort((a, b) => a.entity_id.localeCompare(b.entity_id));
const offset = msg.offset ?? 30;
let schedules = /* @__PURE__ */ new Map();
payload.forEach((entity) => {
  const basename = getEntityBasename(entity.entity_id);
  let time = extractTimeFromPayload(entity.entity_id, payload);
  time = basename.includes("wakeup") ? subtractMinutes(time, offset) : time;
  const cron = basename.includes("weekday") ? createWeekdayCronEntry(time) : createWeekendCronEntry(time);
  schedules.set(basename, { time, cron });
});
msg.payload = Array.from(schedules).map(([key, { time, cron }]) => {
  key = `${key}_cron`;
  const cronEntry = createCronEntry(cron);
  flow.set(key, cronEntry);
  return cronEntry;
});
return msg;
