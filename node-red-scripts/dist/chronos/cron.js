"use strict";
function getEntityBasename(entityId) {
  const match = entityId.match(/^.*\.(.*)$/);
  return match ? match[1] : entityId;
}
function extractTimeFromPayload(entityId, payload2) {
  const entity = payload2.find((item) => item.entity_id === entityId);
  return entity ? entity.state : "00:00";
}
function subtractMinutes(time, minutes) {
  let timeParts = time.split(":");
  let date = /* @__PURE__ */ new Date();
  date.setHours(
    parseInt(timeParts[0]),
    parseInt(timeParts[1]) - minutes,
    parseInt(timeParts[2])
  );
  let hours = date.getHours().toString().padStart(2, "0");
  let mins = date.getMinutes().toString().padStart(2, "0");
  return `${hours}:${mins}`;
}
function createCronEntry(cronExpression) {
  return {
    type: "crontab",
    value: cronExpression
  };
}
function createWeekdayCronEntry(time) {
  const [hours, minutes, seconds] = time.split(":");
  return `0 ${minutes} ${hours} * * 1-5`;
}
function createWeekendCronEntry(time) {
  const [hours, minutes, seconds] = time.split(":");
  return `0 ${minutes} ${hours} * * 0,6`;
}
const payload = msg.payload;
const offset = msg.offset ?? 30;
let schedules = {};
payload.forEach((entity) => {
  const basename = getEntityBasename(entity.entity_id);
  let time = extractTimeFromPayload(entity.entity_id, payload);
  time = subtractMinutes(time, offset);
  const cron = basename.includes("weekday") ? createWeekdayCronEntry(time) : createWeekendCronEntry(time);
  schedules[basename] = { time, cron };
});
msg.payload = Object.keys(schedules).map((key) => {
  const { time, cron } = schedules[key];
  const cronEntry = createCronEntry(cron);
  flow.set(`${key}_cron`, cronEntry);
  return cronEntry;
});
return msg;
