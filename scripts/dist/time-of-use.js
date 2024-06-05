"use strict";
const PRECOOL_TIME = 2 * 60 * 60 * 1e3;
const NOW = /* @__PURE__ */ new Date();
const monthDayToDate = (monthDay) => {
  return /* @__PURE__ */ new Date(`${monthDay}, ${NOW.getFullYear()}`);
};
const hourToDate = (hour) => {
  return /* @__PURE__ */ new Date(`Jan 1 ${hour}, ${NOW.getFullYear()}`);
};
const inRange = (date2, start, end) => {
  return date2 >= start && date2 <= end;
};
class DateInterval {
  constructor(start, end) {
    this.start = monthDayToDate(start);
    this.end = monthDayToDate(end);
    if (this.end.getTime() < this.start.getTime()) {
      this.end.setFullYear(this.end.getFullYear() + 1);
    }
  }
}
class ElectricInterval {
  constructor(start, end, charge) {
    this.start = hourToDate(start);
    this.end = hourToDate(end);
    this.charge = charge;
  }
  normalize(date2) {
    const month = date2.getMonth();
    const day = date2.getDate();
    this.start.setMonth(month, day);
    this.end.setMonth(month, day);
    if (this.end.getTime() < this.start.getTime()) {
      if (this.start.getTime() <= date2.getTime()) {
        this.end.setDate(day + 1);
      } else {
        this.start.setDate(day - 1);
      }
    }
  }
  inRange(date2) {
    this.normalize(date2);
    return inRange(date2, this.start, this.end);
  }
  secondsUntilEnd(date2) {
    this.normalize(date2);
    return (this.end.getTime() - date2.getTime()) / 1e3;
  }
}
class Schedule {
  constructor({ name, dates, on, off, precoolTemp }) {
    this.name = name;
    this.dates = dates;
    this.on = on;
    this.off = off;
    this.precoolTemp = precoolTemp;
  }
  findDateInInterval(date2) {
    const pred = (v) => v.inRange(date2);
    const inDateRange = inRange(date2, this.dates.start, this.dates.end);
    if (inDateRange) {
      let ix = this.off.findIndex(pred);
      if (ix !== -1) {
        const interval = this.off[ix];
        return { status: false, interval };
      }
      ix = this.on.findIndex(pred);
      if (ix !== -1) {
        const interval = this.on[ix];
        return { status: true, interval };
      }
    }
    return void 0;
  }
}
const findDateInSchedules = (date2, schedules2) => {
  schedules2 = schedules2 instanceof Array ? schedules2 : [schedules2];
  for (const schedule of schedules2) {
    const status = schedule.findDateInInterval(date2);
    if (status !== void 0) {
      return {
        schedule,
        status
      };
    }
  }
  return void 0;
};
const createPrecoolPayload = (schedule, status, nextIsOn, delay) => {
  const precool = !status && delay <= PRECOOL_TIME && nextIsOn;
  const precoolTemp = precool ? schedule.precoolTemp : void 0;
  return {
    precool,
    precoolTemp
  };
};
const createPayload = (date2, schedules2) => {
  const pack = (arr) => {
    return arr.map((x) => String(Number(x))).join("");
  };
  const { schedule, status } = findDateInSchedules(date2, schedules2);
  const delay = status.interval.secondsUntilEnd(date2) * 1e3;
  date2.setTime(status.interval.end.getTime() + 1);
  const nextTimestamp = date2.getTime();
  const { status: nextStatus } = findDateInSchedules(date2, schedule);
  const nextIsOn = nextStatus.status;
  const { precool, precoolTemp } = createPrecoolPayload(
    schedule,
    status.status,
    nextIsOn,
    delay
  );
  const action = pack([status.status, precool]);
  const payload = {
    status: status.status,
    nextTimestamp,
    delay,
    action,
    precoolTemp
  };
  return payload;
};
const summer = new Schedule({
  name: "summer",
  dates: new DateInterval("May 1", "Oct 31"),
  on: [new ElectricInterval("5:00 PM", "7:00 PM", 0.4)],
  off: [
    new ElectricInterval("6:00 AM", "5:00 PM", 0.08),
    new ElectricInterval("7:00 PM", "10:00 PM", 0.08),
    new ElectricInterval("10:00 PM", "6:00 AM", 0.05)
  ],
  precoolTemp: 21
});
const winter = new Schedule({
  name: "winter",
  dates: new DateInterval("Nov 1", "April 30"),
  on: [new ElectricInterval("6:00 AM", "8:00 AM", 0.4)],
  off: [
    new ElectricInterval("8:00 AM", "10:00 PM", 0.08),
    new ElectricInterval("10:00 PM", "6:00 AM", 0.05)
  ],
  precoolTemp: 20
});
const schedules = [summer, winter];
const message = msg;
const date = new Date(message.timestamp);
message.payload = createPayload(date, schedules);
msg = message;
return msg;
