import {
    dateToTimeString,
    extractTimeFromPayload,
    getEntityBasename,
    getTimeComponents,
    timeStringToDate
} from "../utils/utils";

// Create and store cron expressions for scheduler node
function createCronEntry(cronExpression: string) {
    return {
        type: "crontab",
        value: cronExpression
    };
}

function createWeekdayCronEntry(time: string) {
    const [hours, minutes, seconds] = getTimeComponents(time);
    return `${seconds} ${minutes} ${hours} * * 1-5`;
}

function createWeekendCronEntry(time: string) {
    const [hours, minutes, seconds] = getTimeComponents(time);
    return `${seconds} ${minutes} ${hours} * * 0,6`;
}

const currentTime = new Date();

// @ts-ignore
const offset = msg.offset || 30;

// @ts-ignore
const payload = msg.payload.sort((a, b) => a.entity_id.localeCompare(b.entity_id));

let schedules = new Map<string, { time: string; cron: string }>();

payload.forEach((entity: Hass.State) => {
    const basename = getEntityBasename(entity.entity_id);

    let time = extractTimeFromPayload(entity.entity_id, payload);
    const dateTime = timeStringToDate(time);

    // if time contains "wakeup" then calculate the wakeup time based on the offset
    if (basename.includes("wakeup")) {
        const offsetTime = new Date(dateTime.getTime());
        offsetTime.setMinutes(dateTime.getMinutes() - offset);

        // if the offsetTime is in the past (relative to the currentTime), then set the wakeup time to the dateTime
        const wakeupTime =
            offsetTime.getTime() < currentTime.getTime() ? dateTime : offsetTime;

        time = dateToTimeString(wakeupTime);
    }

    const cron = basename.includes("weekday")
        ? createWeekdayCronEntry(time)
        : createWeekendCronEntry(time);

    schedules.set(basename, { time, cron });
});

// @ts-ignore
msg.payload = Array.from(schedules).map(([key, { time, cron }]) => {
    key = `${key}_cron`;

    const cronEntry = createCronEntry(cron);
    // @ts-ignore
    flow.set(key, cronEntry);

    return cronEntry;
});
