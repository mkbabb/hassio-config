"use strict";
function getTimeComponents(time) {
  let timeParts = time.split(":");
  let [hours, mins, seconds] = timeParts.concat(Array(3 - timeParts.length).fill("00")).map((x) => parseInt(x));
  return [hours, mins, seconds];
}
function normalizeTime(time) {
  let [hours, mins, seconds] = getTimeComponents(time);
  return `${hours}:${mins}:${seconds}`;
}
function timeStringToDate(time) {
  time = normalizeTime(time);
  let [hours, mins, seconds] = getTimeComponents(time);
  let date = /* @__PURE__ */ new Date();
  date.setHours(hours);
  date.setMinutes(mins);
  date.setSeconds(seconds);
  return date;
}
const currentTime = /* @__PURE__ */ new Date();
const payloadTime = timeStringToDate(msg.payload.state);
const minutes = new Date(currentTime.getTime() - payloadTime.getTime()).getMinutes();
msg.delay = Math.max(0, minutes);
return msg;
