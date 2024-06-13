import { timeStringToDate } from "../utils/utils";

const currentTime = new Date();
// @ts-ignore
const payloadTime = timeStringToDate(msg.payload.state);

// get the number of minutes between the current time and the payload time
const minutes = new Date(currentTime.getTime() - payloadTime.getTime()).getMinutes();

// return the number of minutes
// @ts-ignore
msg.delay = Math.max(0, minutes);
