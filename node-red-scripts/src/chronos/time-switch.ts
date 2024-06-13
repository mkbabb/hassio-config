import { extractTimeFromPayload, getEntityBasename } from "../utils/utils";
//@ts-ignore
const payload: Entity[] = msg.payload;

// Rename wakeup_time and sleep_time to bedroom_start and bedroom_end
const wakeUpTime = payload.find((entity) => entity.entity_id.includes("wakeup_time"));
if (wakeUpTime) {
    wakeUpTime.entity_id = "bedroom_schedule_start";
}

const sleepTime = payload.find((entity) => entity.entity_id.includes("sleep_time"));
if (sleepTime) {
    sleepTime.entity_id = "bedroom_schedule_end";
}

// Extract times using the entity IDs
const schedules = {};

payload.forEach((entity) => {
    const basename = getEntityBasename(entity.entity_id);

    const match = basename.match(/^(.*)_(start|end)$/);

    if (match) {
        const [_, name, timeType] = match;

        if (!schedules[name]) {
            schedules[name] = { start: "", end: "" };
        }

        schedules[name][timeType] = extractTimeFromPayload(entity.entity_id, payload);
    }
});

function createScheduleObject(start: string, end: string, operator: string) {
    let operands;

    if (operator === "between" || operator === "outside") {
        operands = [
            { type: "time", value: start, offset: 0, random: false },
            { type: "time", value: end, offset: 0, random: false }
        ];
    } else {
        operands = { type: "time", value: start, offset: 0, random: false };
    }

    return { operator: operator, operands: operands };
}

//@ts-ignore
msg.payload = Object.keys(schedules)
    .map((key) => {
        const betweenSchedule = createScheduleObject(
            schedules[key].start,
            schedules[key].end,
            "between"
        );
        //@ts-ignore
        flow.set(`${key}_between`, betweenSchedule);

        const outsideSchedule = createScheduleObject(
            schedules[key].start,
            schedules[key].end,
            "outside"
        );
        //@ts-ignore
        flow.set(`${key}_outside`, outsideSchedule);

        return [betweenSchedule, outsideSchedule];
    })
    .flat();
