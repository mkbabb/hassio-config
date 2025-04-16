// @ts-ignore
const message = msg;

// Data from the input sensor
const data = message.data;

const dataEntityId = data.entity_id;

// Topic of the message
const topic: string = message.topic ?? dataEntityId;

const flowInfoKey = `flowInfo.${topic}`;

// @ts-ignore
msg.data = flow.get(flowInfoKey) ?? {};
