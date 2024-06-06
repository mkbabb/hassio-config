import { subtractMinutes, extractTimeFromPayload, getEntityBasename } from "../utils";

// Create and store cron expressions for scheduler node
function createCronEntry(cronExpression: string) {
    return {
        type: "crontab",
        value: cronExpression
    };
}

function createWeekdayCronEntry(time: string) {
    const [hours, minutes, seconds] = time.split(":");
    return `0 ${minutes} ${hours} * * 1-5`;
}

function createWeekendCronEntry(time: string) {
    const [hours, minutes, seconds] = time.split(":");
    return `0 ${minutes} ${hours} * * 0,6`;
}

// @ts-ignore
const payload = msg.payload;

// @ts-ignore
// offset in minutes
const offset = msg.offset ?? 30;

let schedules = {};

// Extract times using the entity IDs
payload.forEach((entity: Hass.State) => {
    const basename = getEntityBasename(entity.entity_id);

    let time = extractTimeFromPayload(entity.entity_id, payload);
    time = subtractMinutes(time, offset);

    const cron = basename.includes("weekday")
        ? createWeekdayCronEntry(time)
        : createWeekendCronEntry(time);

    schedules[basename] = { time, cron };
});

// @ts-ignore
msg.payload = Object.keys(schedules).map((key) => {
    const { time, cron } = schedules[key];
    const cronEntry = createCronEntry(cron);

    // @ts-ignore
    flow.set(`${key}_cron`, cronEntry);

    return cronEntry;
});
