"use strict";
function extractTimeFromPayload(entityId, payload2) {
  const entity = payload2.find((item) => item.entity_id === entityId);
  return entity ? entity.state : "00:00";
}
const payload = msg.payload;
const schedules = {};
payload.forEach((entity) => {
  const match = entity.entity_id.match(/^(.*)_(start|end)$/);
  if (match) {
    const [_, baseName, timeType] = match;
    if (!schedules[baseName]) {
      schedules[baseName] = { start: "", end: "" };
    }
    schedules[baseName][timeType] = extractTimeFromPayload(
      entity.entity_id,
      payload
    );
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
