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

    const scheduleTime = timeStringToDate(time);

    // 9
    // 8:30
    // 8:45

    if (basename.includes("wakeup")) {
        const offsetTime = new Date(scheduleTime.getTime());
        offsetTime.setMinutes(scheduleTime.getMinutes() - offset);

        // Check if the offset time is in the past
        // But only if the current time is between the offset time and the schedule time
        if (
            now.getTime() >= offsetTime.getTime() &&
            now.getTime() <= scheduleTime.getTime()
        ) {
            offsetTime.setMinutes(now.getMinutes() - scheduleTime.getMinutes());
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
