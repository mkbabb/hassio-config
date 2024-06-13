"use strict";
function getEntityBasename(entityId) {
  const match = entityId.match(/^.*\.(.*)$/);
  return match ? match[1] : entityId;
}
const cron = msg.cron.replace(/_cron$/, "");
const payload = msg.payload;
const entity = payload.filter((entity2) => {
  const name = getEntityBasename(entity2.entity_id);
  return name === cron;
})[0];
msg.payload = entity;
return msg;
