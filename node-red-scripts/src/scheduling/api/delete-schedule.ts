/**
 * Delete Schedule API - DELETE /endpoint/schedules/:name
 *
 * Node wiring:
 *   [http-in: DELETE /endpoint/schedules/:name] → [function: this] → [http-response]
 *
 * Only dynamic schedules can be deleted. Static schedules return 403.
 */

import { deleteSchedule } from "./registry";

// @ts-ignore - Node-RED global
const message = msg;

const name = message.req?.params?.name;

if (!name) {
    message.payload = { error: "Schedule name is required" };
    message.statusCode = 400;
} else {
    const result = deleteSchedule(name);

    if (result.deleted) {
        message.payload = { success: true, deleted: name };
        message.statusCode = 200;
    } else if (result.reason === "not_found") {
        message.payload = { error: `Schedule "${name}" not found` };
        message.statusCode = 404;
    } else if (result.reason === "static_schedule") {
        message.payload = { error: `Cannot delete static schedule "${name}". Use PUT to disable it.` };
        message.statusCode = 403;
    }
}

// @ts-ignore
msg = message;
