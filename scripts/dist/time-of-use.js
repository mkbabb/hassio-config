const now = new Date();
const monthDayToDate = (monthDay) => {
    return new Date(`${monthDay}, ${now.getFullYear()}`);
};
const hourToDate = (hour) => {
    return new Date(`Jan 1 ${hour}, ${now.getFullYear()}`);
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
        if (this.end.getMonth() === month) {
            return;
        }
        this.start.setMonth(month, day);
        this.end.setMonth(month, day);
        if (this.end.getTime() - this.start.getTime() < 0) {
            this.start.setDate(day - 1);
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
    constructor({ dates, on, off }) {
        this.dates = dates;
        this.on = on;
        this.off = off;
    }
    findDateInInterval(date) {
        const pred = (v) => v.inRange(date);
        const inDateRange = inRange(date, this.dates.start, this.dates.end);
        if (inDateRange) {
            let interval = this.off.find(pred);
            if (interval !== undefined) {
                return { status: "off", interval };
            }
            else {
                interval = this.on.find(pred);
                if (interval !== undefined) {
                    return { status: "on", interval };
                }
            }
        }
        return undefined;
    }
}
const findDateInSchedules = (date, schedules) => {
    return schedules
        .map((v) => v.findDateInInterval(date))
        .find((v) => v !== undefined);
};
const summer = new Schedule({
    dates: new DateInterval("May 1", "Oct 31"),
    on: [new ElectricInterval("5:00 PM", "7:00 PM", 0.4)],
    off: [
        new ElectricInterval("6:00 AM", "5:00 PM", 0.08),
        new ElectricInterval("10:00 PM", "6:00 AM", 0.05)
    ]
});
const winter = new Schedule({
    dates: new DateInterval("Nov 1", "April 30"),
    on: [new ElectricInterval("6:00 AM", "8:00 AM", 0.4)],
    off: [
        new ElectricInterval("8:00 AM", "10:00 PM", 0.08),
        new ElectricInterval("10:00 PM", "6:00 AM", 0.05)
    ]
});
const schedules = [summer, winter];
//@ts-ignore
const message = msg;
const date = new Date(message.time);
const electricInterval = findDateInSchedules(date, schedules);
if (electricInterval != undefined) {
    const secondsUntilEnd = electricInterval.interval.secondsUntilEnd(date);
    date.setSeconds(date.getSeconds() + secondsUntilEnd);
    message.payload = {
        cache: electricInterval.status,
        delay: secondsUntilEnd * 1000,
        timestamp: date.getTime()
    };
}
else {
    message.payload = {
        cache: "none"
    };
}
//@ts-ignore
return message;
