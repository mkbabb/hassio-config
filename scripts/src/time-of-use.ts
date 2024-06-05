const PRECOOL_TIME = 2 * 60 * 60 * 1000;

const NOW = new Date();

const monthDayToDate = (monthDay: String) => {
    return new Date(`${monthDay}, ${NOW.getFullYear()}`);
};

const hourToDate = (hour: String) => {
    return new Date(`Jan 1 ${hour}, ${NOW.getFullYear()}`);
};

const inRange = (date: Date | number, start: Date | number, end: Date | number) => {
    return date >= start && date <= end;
};

class DateInterval {
    start: Date;
    end: Date;

    constructor(start: string, end: string) {
        this.start = monthDayToDate(start);
        this.end = monthDayToDate(end);

        if (this.end.getTime() < this.start.getTime()) {
            this.end.setFullYear(this.end.getFullYear() + 1);
        }
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

        this.start.setMonth(month, day);
        this.end.setMonth(month, day);

        if (this.end.getTime() < this.start.getTime()) {
            if (this.start.getTime() <= date.getTime()) {
                this.end.setDate(day + 1);
            } else {
                this.start.setDate(day - 1);
            }
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
    name: string;
    dates: DateInterval;
    on: ElectricInterval[];
    off: ElectricInterval[];
    precoolTemp: number;
}

class Schedule {
    name: string;

    dates: DateInterval;
    on: ElectricInterval[];
    off: ElectricInterval[];

    precoolTemp: number;

    constructor({ name, dates, on, off, precoolTemp }: ScheduleObj) {
        this.name = name;
        this.dates = dates;

        this.on = on;
        this.off = off;

        this.precoolTemp = precoolTemp;
    }

    findDateInInterval(date: Date) {
        const pred = (v: ElectricInterval) => v.inRange(date);

        const inDateRange = inRange(date, this.dates.start, this.dates.end);

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

        return undefined;
    }
}

const findDateInSchedules = (date: Date, schedules: Array<Schedule> | Schedule) => {
    schedules = schedules instanceof Array ? schedules : [schedules];

    for (const schedule of schedules) {
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

const createPrecoolPayload = (
    schedule: Schedule,
    status: boolean,
    nextIsOn: boolean,
    delay: number
) => {
    const precool = !status && delay <= PRECOOL_TIME && nextIsOn;
    const precoolTemp = precool ? schedule.precoolTemp : undefined;

    return {
        precool,
        precoolTemp
    };
};

const createPayload = (date: Date, schedules: Array<Schedule>) => {
    const pack = (arr: Array<Boolean>) => {
        return arr.map((x) => String(Number(x))).join("");
    };
    const { schedule, status } = findDateInSchedules(date, schedules);

    const delay = status.interval.secondsUntilEnd(date) * 1000;
    date.setTime(status.interval.end.getTime() + 1);
    const nextTimestamp = date.getTime();

    const { status: nextStatus } = findDateInSchedules(date, schedule);
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

//@ts-ignore
const message: Hass.Message = msg;
const date = new Date(message.timestamp);

message.payload = createPayload(date, schedules);

//@ts-ignore
msg = message;


