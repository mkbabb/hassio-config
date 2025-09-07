import { isInCoolDownPeriod, getRemainingCoolDownMs, PresenceState } from "./utils";

// @ts-ignore
const message = msg;

// Data from the input sensor
const data = message.data;

const dataEntityId = data.entity_id;

// Topic of the message
const topic: string = message.topic ?? dataEntityId;

const flowInfoKey = `flowInfo.${topic}`;

// @ts-ignore
const flowInfo = flow.get(flowInfoKey) ?? {};

// Check if we're still in a cooldown period
if (flowInfo.state === PresenceState.PENDING_OFF) {
    // If we're in cooldown and state is pending off, set delay to remaining cooldown time
    if (isInCoolDownPeriod(flowInfo)) {
        // @ts-ignore
        msg.delay = getRemainingCoolDownMs(flowInfo);
    } else {
        // If cooldown is over, reset state to OFF and clear cooldown
        flowInfo.state = PresenceState.OFF;
        flowInfo.coolDownEndTime = null;
        flowInfo.delay = 0;
        // @ts-ignore
        flow.set(flowInfoKey, flowInfo);
        // @ts-ignore
        msg.delay = 0;
    }
} else {
    // Otherwise, no delay and pass through current flow info state
    // @ts-ignore
    msg.delay = 0;
}

// Pass the flow info data
// @ts-ignore
msg.data = flowInfo;
