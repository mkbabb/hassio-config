import {
    dateToTimeString,
    extractTimeFromPayload,
    getEntityBasename,
    getTimeComponents,
    timeStringToDate
} from "../utils/utils";

// Create and store cron expressions for scheduler node
function createChronosCronEntry(cronExpression: string) {
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

function createCronEntry(basename: string, time: string) {
    return basename.includes("weekday")
        ? createWeekdayCronEntry(time)
        : createWeekendCronEntry(time);
}

function createLightTransitionPayload(duration: number) {
    return {
        duration,
        units: "Minute",
        steps: duration
    };
}

const now = new Date();

// @ts-ignore
const offset = msg.offset || 30;

// @ts-ignore
const payload = msg.payload.sort((a, b) => a.entity_id.localeCompare(b.entity_id));

let schedules = new Map<string, { time: string; cron: string }>();

payload.forEach((entity: Hass.State) => {
    const basename = getEntityBasename(entity.entity_id);
    let time = extractTimeFromPayload(entity.entity_id, payload);

    schedules.set(basename, { time, cron: createCronEntry(basename, time) });

    const dateTime = timeStringToDate(time);

    if (basename.includes("wakeup")) {
        const offsetTime = new Date(dateTime.getTime());
        offsetTime.setMinutes(dateTime.getMinutes() - offset);

        // if the offset time is in the past,
        // set it to the current time, just 30 seconds in the future
        if (offsetTime.getTime() < now.getTime()) {
            offsetTime.setMinutes(now.getMinutes());
            offsetTime.setSeconds(now.getSeconds() + 30);
        }
        // but ensure this is still less than the original time
        if (offsetTime.getTime() >= dateTime.getTime()) {
            offsetTime.setMinutes(dateTime.getMinutes());
            offsetTime.setSeconds(dateTime.getSeconds() - 30);
        }

        time = dateToTimeString(offsetTime);
        const preName = `pre_${basename}`;

        schedules.set(preName, { time, cron: createCronEntry(preName, time) });
    }
});

// @ts-ignore
msg.schedules = schedules;
// @ts-ignore
msg.payload = Array.from(schedules).map(([key, { time, cron }]) => {
    const cronEntry = createChronosCronEntry(cron);
    // @ts-ignore
    flow.set(key, cronEntry);
    return cronEntry;
});
