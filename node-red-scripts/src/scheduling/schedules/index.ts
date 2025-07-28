// Import types from separate file
import type {
    Schedule,
    ScheduleCondition,
    NormalizedSchedule,
    ScheduleEvent
} from "../types";
import { plantSchedules } from "./plants-schedules";
import { dayNightSchedules } from "./day-night-schedules";
import { blindsSchedules } from "./blinds-schedules";
import { lockSchedules } from "./lock-schedules";

// Combine all schedules from separate modules
// @ts-ignore
const schedules: Schedule[] = [
    ...dayNightSchedules,
    ...plantSchedules,
    ...blindsSchedules,
    ...lockSchedules
];

// Tag definitions for entity matching
// @ts-ignore
const tagDefinitions = {
    plants: [".*grow.*"],
    bedroom_plants: [".*bedroom.*grow.*", ".*master.*grow.*"],
    warocqueanum: [".*warocqueanum.*", "light\.titanic_light"],
};

// @ts-ignore
flow.set("schedules", schedules);
// @ts-ignore
flow.set("tagDefinitions", tagDefinitions);
