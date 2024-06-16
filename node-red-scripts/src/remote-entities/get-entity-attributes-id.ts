import { getEntityBasename } from "../utils/utils";

// @ts-ignore
const entityId = msg.payload.target.entity_id;
const basename = getEntityBasename(entityId);

const entityAttributesId = `input_text.${basename}_attributes`;
const entityStateId = `input_text.${basename}_state`;

// @ts-ignore
msg.payload.target.entity_attributes_id = entityAttributesId;
// @ts-ignore
msg.payload.target.entity_state_id = entityStateId;
