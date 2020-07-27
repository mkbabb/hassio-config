//@ts-expect-error
const message: Hass.Message = msg;
const { entity_id: entityId, attributes, state } = message.data.new_state;

// Open and close sensors are of the form: $sensor_name sensor,
// so we strip the latter.
const trimSensorName = function (sensorName: string) {
    return sensorName.replace(new RegExp("sensor", "i"), "").trim().toLowerCase();
};

// gets the current local time in string form.
const getTimeString = function () {
    const timeObject = new Date(Date.now());
    const options: Intl.DateTimeFormatOptions = {
        year: "numeric",
        month: "long",
        day: "numeric",
        weekday: "long",
        hour: "numeric",
        minute: "numeric",
        second: "numeric",
        hour12: false,
        timeZone: "America/New_York"
    };

    const locale = "en-US";

    return timeObject.toLocaleString(locale, options);
};

const doorName = trimSensorName(attributes.friendly_name);
const doorState = message.payload === "on" ? "opened" : "closed";
const time = getTimeString();

const payload = {
    data: {
        title: `${doorName} was ${doorState}`,
        message: `The ${doorName} was ${doorState} at ${time}`
    },
    ...{ doorName, doorState, time, entity_id: entityId }
};

message.payload = payload;
//@ts-ignore
return message;
export {};
