import { timeStringToDate } from "../utils/utils";

// @ts-ignore
const schedules: Map<string, { time: string; cron: string }> = msg.schedules;

// @ts-ignore
const preScheduleName: string = msg.schedule;
const scheduleName = preScheduleName.replace(/^pre_/, "");

const schedule = schedules.get(scheduleName);
const preSchedule = schedules.get(preScheduleName);

const time = timeStringToDate(schedule.time);
const preTime = timeStringToDate(preSchedule.time);

const currentTime = new Date();

const inPreambleWindow = currentTime >= preTime && currentTime < time;

//@ts-ignore
msg.payload = inPreambleWindow;
