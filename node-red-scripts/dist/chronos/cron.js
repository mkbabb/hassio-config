"use strict";
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
  const [start, end] = time.split(":");
  return `${start} ${end} * * 1-5`;
}
function createWeekendCronEntry(time) {
  const [start, end] = time.split(":");
  return `${start} ${end} * * 6-7`;
}
const payload = msg.payload;
const offset = msg.offset ?? 30;
let schedules = {};
payload.forEach((entity) => {
  const match = entity.entity_id.match(/^.*\.(.*)$/);
  const [_, baseName] = match;
  let time = extractTimeFromPayload(entity.entity_id, payload);
  time = subtractMinutes(time, offset);
  const cron = baseName.includes("weekday") ? createWeekdayCronEntry(time) : createWeekendCronEntry(time);
  schedules[baseName] = { time, cron };
});
msg.payload = Object.keys(schedules).map((key) => {
  const { time, cron } = schedules[key];
  flow.set(`${key}_cron`, time);
  return createCronEntry(cron);
});
return msg;
