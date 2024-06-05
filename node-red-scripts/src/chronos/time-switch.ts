import { extractTimeFromPayload } from "../utils";
//@ts-ignore
const payload: Entity[] = msg.payload;

// Extract times using the entity IDs
const schedules = {};

payload.forEach((entity) => {
    const match = entity.entity_id.match(/^(.*)_(start|end)$/);

    if (match) {
        const [_, baseName, timeType] = match;

        if (!schedules[baseName]) {
            schedules[baseName] = { start: "", end: "" };
        }

        schedules[baseName][timeType] = extractTimeFromPayload(
            entity.entity_id,
            payload
        );
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
