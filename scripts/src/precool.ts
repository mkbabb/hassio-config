const pack = (arr: Array<Boolean>) => {
    return arr.map((x) => String(Number(x))).join("");
};

const scheduleTemperatures = {
    summer: 21,
    winter: 21
};

const precoolTime = 2 * 60 * 60 * 1000 * 100;

//@ts-ignore
const message: Hass.Message = msg;

const delay = message.delay;
const status = message.status;
const scheduleName = message.scheduleName;

const precool = !status && delay <= precoolTime;
const temperature = scheduleTemperatures[scheduleName];

const action = pack([status, precool]);

message.payload = {
    precool,
    temperature,
    action
};
//@ts-ignore
return message;
export {};
