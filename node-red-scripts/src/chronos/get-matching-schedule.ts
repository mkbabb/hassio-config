import { getEntityBasename } from "../utils/utils";

// @ts-ignore
const cron = msg.cron.replace(/_cron$/, "");

// @ts-ignore
const payload = msg.payload;

const entity = payload.filter((entity) => {
    const name = getEntityBasename(entity.entity_id);
    return name === cron;
})[0];

// @ts-ignore
msg.payload = entity;
