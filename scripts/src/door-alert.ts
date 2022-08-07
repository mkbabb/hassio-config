//@ts-expect-error
const message: Hass.Message = msg;
const { doorName, doorState, time: closeTime } = message.payload;

// format of the iOS notification.
const notificationPayload = {
    data: {
        title: `${doorName} not closed!`,
        message: `The ${doorName} hasn't been closed since ${closeTime}!`
    }
};

message.payload = notificationPayload;
//@ts-ignore
return message;
export {};
