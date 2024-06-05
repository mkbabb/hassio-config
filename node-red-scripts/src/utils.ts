export function extractTimeFromPayload(
    entityId: string,
    payload: Hass.State[]
): string {
    const entity = payload.find((item) => item.entity_id === entityId);
    return entity ? entity.state : "00:00";
}

export function subtractMinutes(time: string, minutes: number): string {
    let timeParts = time.split(":");
    let date = new Date();
    date.setHours(
        parseInt(timeParts[0]),
        parseInt(timeParts[1]) - minutes,
        parseInt(timeParts[2])
    );

    // Formatting to "HH:MM" for cron expression usage
    let hours = date.getHours().toString().padStart(2, "0");
    let mins = date.getMinutes().toString().padStart(2, "0");

    return `${hours}:${mins}`;
}

export function getTimeString(): string {
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
}
