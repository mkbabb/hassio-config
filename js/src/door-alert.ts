//@ts-expect-error
const message: Hass.Message = msg;
const { doorName, doorState, time: closeTime } = message.payload;

const payload = {
    data: {
        title: `${doorName} not closed!`,
        message: `The ${doorName} hasn't been closed since ${closeTime}!`
    }
};

message.payload = payload;
//@ts-ignore
return message;
export {};
