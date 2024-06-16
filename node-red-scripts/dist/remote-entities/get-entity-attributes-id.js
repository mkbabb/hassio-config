"use strict";
function getEntityBasename(entityId2) {
  const match = entityId2.match(/^.*\.(.*)$/);
  return match ? match[1] : entityId2;
}
const entityId = msg.payload.target.entity_id;
const basename = getEntityBasename(entityId);
const entityAttributesId = `input_text.${basename}_attributes`;
const entityStateId = `input_text.${basename}_state`;
msg.payload.target.entity_attributes_id = entityAttributesId;
msg.payload.target.entity_state_id = entityStateId;
return msg;
