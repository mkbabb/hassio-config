const PRECOOL_TIME = 2 * 60 * 60 * 1000;
const NOW = new Date();
const monthDayToDate = (monthDay) => {
    return new Date(`${monthDay}, ${NOW.getFullYear()}`);
};
const hourToDate = (hour) => {
    return new Date(`Jan 1 ${hour}, ${NOW.getFullYear()}`);
};
const inRange = (date, start, end) => {
    return date > start && date < end;
};
class DateInterval {
    constructor(start, end) {
        this.start = monthDayToDate(start);
        this.end = monthDayToDate(end);
    }
}
class ElectricInterval {
    constructor(start, end, charge) {
        this.start = hourToDate(start);
        this.end = hourToDate(end);
        this.charge = charge;
    }
    normalize(date) {
        const month = date.getMonth();
        const day = date.getDate();
        const time = date.getTime();
        if (this.end.getMonth() === month) {
            return;
        }
        this.start.setMonth(month, day);
        this.end.setMonth(month, day);
        if (this.end.getTime() < this.start.getTime()) {
            if (this.start.getTime() <= date.getTime()) {
                this.end.setDate(day + 1);
            }
            else {
                this.start.setDate(day - 1);
            }
        }
    }
    inRange(date) {
        this.normalize(date);
        return inRange(date, this.start, this.end);
    }
    secondsUntilEnd(date) {
        this.normalize(date);
        return (this.end.getTime() - date.getTime()) / 1000;
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
    findDateInInterval(date) {
        const pred = (v) => v.inRange(date);
        const inDateRange = inRange(date, this.dates.start, this.dates.end);
        if (inDateRange) {
            let interval = this.off.find(pred);
            if (interval !== undefined) {
                return { status: false, interval };
            }
            else {
                interval = this.on.find(pred);
                if (interval !== undefined) {
                    return { status: true, interval };
                }
            }
        }
        return undefined;
    }
}
const findDateInSchedules = (date, schedules) => {
    for (const [scheduleName, schedule] of Object.entries(schedules)) {
        const status = schedule.findDateInInterval(date);
        if (status !== undefined) {
            return {
                schedule,
                status
            };
        }
    }
    return undefined;
};
const createPrecoolPayload = (schedule, status, delay) => {
    const precool = !status && delay <= PRECOOL_TIME;
    const precoolTemp = precool ? schedule.precoolTemp : undefined;
    return {
        precool,
        precoolTemp
    };
};
const createPayload = (date, schedules) => {
    var _a;
    const pack = (arr) => {
        return arr.map((x) => String(Number(x))).join("");
    };
    const { schedule, status } = (_a = findDateInSchedules(date, schedules)) !== null && _a !== void 0 ? _a : {};
    if (schedule === undefined) {
        return { status: undefined };
    }
    const delay = status.interval.secondsUntilEnd(date) * 1000;
    date.setTime(status.interval.end.getTime());
    const timestamp = date.getTime();
    const { precool, precoolTemp } = createPrecoolPayload(schedule, status.status, delay);
    const action = pack([status.status, precool]);
    const payload = {
        status: status.status,
        timestamp,
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
    precoolTemp: 21
});
const schedules = { summer, winter };
//@ts-ignore
const message = msg;
const date = new Date(message.timestamp);
message.payload = createPayload(date, schedules);
//@ts-ignore
return message;
export {};
