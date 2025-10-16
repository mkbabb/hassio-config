import { isInCoolDownPeriod, getRemainingCoolDownMs, PresenceState } from "./utils";

// @ts-ignore
const message = msg;

// Data from the input sensor (may not exist after trigger)
const data = message.data || {};
const dataEntityId = data.entity_id || '';

// Topic of the message - MUST match what presence.ts used
// msg.topic should be preserved through the trigger node
const topic: string = message.topic || dataEntityId || 'unknown';


const flowInfoKey = `flowInfo.${topic}`;

// @ts-ignore
const flowInfo = flow.get(flowInfoKey) ?? {};

// Get presence states to check current sensor status
const presenceStatesKey = `presenceStates.${topic}`;
// @ts-ignore
const presenceStates = flow.get(presenceStatesKey) || {};
const hasPresence = Object.values(presenceStates).some(state => state === 'on');

// The trigger node sends two messages:
// 1. Immediate: null payload (to reset/cancel)
// 2. After delay: original payload (to execute action)

// If we have a payload, this is the second (delayed) message from trigger
if (message.payload) {
    // This is the delayed message - cooldown has expired
    // Check current sensor states before executing the action
    if (hasPresence) {
        // Motion detected during cooldown - cancel turn off
        flowInfo.state = PresenceState.ON;
        flowInfo.coolDownEndTime = null;
        flowInfo.delay = 0;
        // @ts-ignore
        flow.set(flowInfoKey, flowInfo);
        // @ts-ignore
        msg.payload = null; // Clear payload to prevent turn_off
    } else {
        // No motion detected - proceed with turn off
        flowInfo.state = PresenceState.OFF;
        flowInfo.coolDownEndTime = null;
        flowInfo.delay = 0;
        // @ts-ignore
        flow.set(flowInfoKey, flowInfo);
        // Keep the turn_off payload to execute - it's already in msg.payload
    }
} else {
    // This is the immediate message (null payload)
    // Just pass through without changing state
    // The state remains PENDING_OFF during cooldown
}
// Always pass through the original message
// @ts-ignore
msg.delay = msg.delay || 0;

// Pass the flow info data
// @ts-ignore
msg.data = flowInfo;
