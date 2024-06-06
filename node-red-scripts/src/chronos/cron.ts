import {
    subtractMinutes,
    extractTimeFromPayload,
    getEntityBasename,
    getTimeComponents
} from "../utils";

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

// @ts-ignore
const payload = msg.payload.sort((a, b) => a.entity_id.localeCompare(b.entity_id));

// @ts-ignore
// offset in minutes
const offset = msg.offset ?? 30;

let schedules = new Map<string, { time: string; cron: string }>();

payload.forEach((entity: Hass.State) => {
    const basename = getEntityBasename(entity.entity_id);

    let time = extractTimeFromPayload(entity.entity_id, payload);
    // subtract offset minutes if it's a wakeup schedule
    time = basename.includes("wakeup") ? subtractMinutes(time, offset) : time;

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
