const scheduleTemperatures = {
    summer: 21,
    winter: 21
};
const precoolTime = 2 * 60 * 60 * 1000;
//@ts-ignore
const message = msg;
const delay = message.delay;
const cache = message.cache;
const scheduleName = message.scheduleName;
const precool = cache === "on" && delay <= precoolTime;
const temperature = scheduleTemperatures[scheduleName];
message.payload = {
    precool,
    temperature
};
//@ts-ignore
return message;
export {};
