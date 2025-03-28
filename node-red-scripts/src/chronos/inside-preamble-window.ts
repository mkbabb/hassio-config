import { timeStringToDate } from "../utils/utils";

// @ts-ignore
const schedules: Map<string, { time: string; cron: string }> = msg.schedules;

// @ts-ignore
const preScheduleName: string = msg.schedule;
const scheduleName = preScheduleName.replace(/^pre_/, "");

const schedule = schedules.get(scheduleName);
const preSchedule = schedules.get(preScheduleName);

const scheduleTime = timeStringToDate(schedule.time);
const preScheduleTime = timeStringToDate(preSchedule.time);

const currentTime = new Date();

const inPreambleWindow = currentTime >= preScheduleTime && currentTime < scheduleTime;

//@ts-ignore
msg.payload = inPreambleWindow;
