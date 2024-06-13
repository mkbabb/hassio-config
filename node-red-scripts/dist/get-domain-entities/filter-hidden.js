"use strict";
const payload = msg.payload;
const domains = flow.get("domains");
const entities = payload.filter((entity) => entity.hidden_by === null).filter((entity) => {
  const domain = entity.entity_id.split(".")[0];
  return domains.includes(domain);
});
msg.payload = entities;
return msg;
