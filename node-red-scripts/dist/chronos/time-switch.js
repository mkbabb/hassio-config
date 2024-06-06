"use strict";
function getEntityBasename(entityId) {
  const match = entityId.match(/^.*\.(.*)$/);
  return match ? match[1] : entityId;
}
function extractTimeFromPayload(entityId, payload2) {
  const entity = payload2.find((item) => item.entity_id === entityId);
  return entity ? entity.state : "00:00";
}
const payload = msg.payload;
const wakeUpTime = payload.find((entity) => entity.entity_id.includes("wakeup_time"));
if (wakeUpTime) {
  wakeUpTime.entity_id = "bedroom_schedule_start";
}
const sleepTime = payload.find((entity) => entity.entity_id.includes("sleep_time"));
if (sleepTime) {
  sleepTime.entity_id = "bedroom_schedule_end";
}
const schedules = {};
payload.forEach((entity) => {
  const basename = getEntityBasename(entity.entity_id);
  const match = basename.match(/^(.*)_(start|end)$/);
  if (match) {
    const [_, name, timeType] = match;
    if (!schedules[name]) {
      schedules[name] = { start: "", end: "" };
    }
    schedules[name][timeType] = extractTimeFromPayload(entity.entity_id, payload);
  }
});
function createScheduleObject(start, end, operator) {
  let operands;
  if (operator === "between" || operator === "outside") {
    operands = [
      { type: "time", value: start, offset: 0, random: false },
      { type: "time", value: end, offset: 0, random: false }
    ];
  } else {
    operands = { type: "time", value: start, offset: 0, random: false };
  }
  return { operator, operands };
}
msg.payload = Object.keys(schedules).map((key) => {
  const betweenSchedule = createScheduleObject(
    schedules[key].start,
    schedules[key].end,
    "between"
  );
  flow.set(`${key}_between`, betweenSchedule);
  const outsideSchedule = createScheduleObject(
    schedules[key].start,
    schedules[key].end,
    "outside"
  );
  flow.set(`${key}_outside`, outsideSchedule);
  return [betweenSchedule, outsideSchedule];
}).flat();
return msg;
