import { subtractMinutes, extractTimeFromPayload } from "../utils";

// Create and store cron expressions for scheduler node
function createCronEntry(cronExpression: string) {
    return {
        type: "crontab",
        value: cronExpression
    };
}

function createWeekdayCronEntry(time: string) {
    const [start, end] = time.split(":");
    return `${start} ${end} * * 1-5`;
}

function createWeekendCronEntry(time: string) {
    const [start, end] = time.split(":");
    return `${start} ${end} * * 6-7`;
}

// @ts-ignore
const payload = msg.payload;

// @ts-ignore
const offset = msg.offset ?? 30;

let schedules = {};

// Extract times using the entity IDs
payload.forEach((entity: Hass.State) => {
    const match = entity.entity_id.match(/^.*\.(.*)$/);
    const [_, baseName] = match;

    let time = extractTimeFromPayload(entity.entity_id, payload);
    time = subtractMinutes(time, offset);

    const cron = baseName.includes("weekday")
        ? createWeekdayCronEntry(time)
        : createWeekendCronEntry(time);

    schedules[baseName] = { time, cron };
});

// @ts-ignore
msg.payload = Object.keys(schedules).map((key) => {
    const { time, cron } = schedules[key];
    // @ts-ignore
    flow.set(`${key}_cron`, time);
    // @ts-ignore
    return createCronEntry(cron);
});
