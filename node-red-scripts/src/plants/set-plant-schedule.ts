// @ts-ignore
let plantScheduleEnd = flow.get("plantScheduleEnd");

// @ts-ignore
const payload = msg.payload;

if (plantScheduleEnd == null) {
    // @ts-ignore
    flow.set("plantScheduleEnd", payload);
}

const date = new Date();
// Get the current hours and minutes of now:
const timeString = date.getHours() + ":" + date.getMinutes();

// @ts-ignore
msg.payload = timeString;

