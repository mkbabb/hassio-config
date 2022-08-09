const now = new Date();

const monthDayToDate = (monthDay: String) => {
    return new Date(`${monthDay}, ${now.getFullYear()}`);
};

const hourToDate = (hour: String) => {
    return new Date(`Jan 1 ${hour}, ${now.getFullYear()}`);
};

const inRange = (date: Date | number, start: Date | number, end: Date | number) => {
    return date > start && date < end;
};

class DateInterval {
    start: Date;
    end: Date;

    constructor(start: string, end: string) {
        this.start = monthDayToDate(start);
        this.end = monthDayToDate(end);
    }
}

class ElectricInterval {
    start: Date;
    end: Date;
    charge: number;

    constructor(start: string, end: string, charge: number) {
        this.start = hourToDate(start);
        this.end = hourToDate(end);
        this.charge = charge;
    }

    normalize(date: Date) {
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

    inRange(date: Date) {
        this.normalize(date);
        return inRange(date, this.start, this.end);
    }

    secondsUntilEnd(date: Date) {
        this.normalize(date);
        return (this.end.getTime() - date.getTime()) / 1000;
    }
}

interface ScheduleObj {
    dates: DateInterval;
    on: Array<ElectricInterval>;
    off: Array<ElectricInterval>;
}

class Schedule {
    dates: DateInterval;
    on: ElectricInterval[];
    off: ElectricInterval[];

    constructor({ dates, on, off }: ScheduleObj) {
        this.dates = dates;

        this.on = on;
        this.off = off;
    }

    findDateInInterval(date: Date) {
        const pred = (v: ElectricInterval) => v.inRange(date);

        const inDateRange = inRange(date, this.dates.start, this.dates.end);

        if (inDateRange) {
            let interval = this.off.find(pred);

            if (interval !== undefined) {
                return { status: false, interval };
            } else {
                interval = this.on.find(pred);
                if (interval !== undefined) {
                    return { status: true, interval };
                }
            }
        }

        return undefined;
    }
}

const findDateInSchedules = (date: Date, schedules: Record<string, Schedule>) => {
    for (const [scheduleName, schedule] of Object.entries(schedules)) {
        const status = schedule.findDateInInterval(date);

        if (status !== undefined) {
            return {
                scheduleName,
                status
            };
        }
    }
    return undefined;
};

const createPayload = (date: Date, schedules: Record<string, Schedule>) => {
    const { scheduleName, status } = findDateInSchedules(date, schedules) ?? {};
    if (scheduleName === undefined) {
        return { status: undefined };
    }

    //@ts-ignore
    const prevStatus = flow.get("status");

    const secondsUntilEnd = status.interval.secondsUntilEnd(date);
    date.setTime(status.interval.end.getTime());

    const payload = {
        scheduleName,
        status: status.status,
        timestamp: date.getTime(),
        delay: secondsUntilEnd * 1000,
        changed: status.status !== prevStatus
    };
    return payload;
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

const schedules = { summer, winter };

//@ts-ignore
const message: Hass.Message = msg;
const date = new Date(message.timestamp);

message.payload = createPayload(date, schedules);

//@ts-ignore
return message;
export {};
