import { isInCoolDownPeriod, getRemainingCoolDownMs, PresenceState } from "./utils";
import { isExternallyModified, clearExternalModification } from "../utils/static-states";
import type { PresenceRegistry, ExternalOverridePolicy } from "./types";

// @ts-ignore
const message = msg;

// Data from the input sensor (may not exist after trigger)
const data = message.data || {};
const dataEntityId = data.entity_id || '';

// Topic of the message - MUST match what presence.ts used
// msg.topic should be preserved through the trigger node
const topic: string = message.topic || dataEntityId || 'unknown';


const flowInfoKey = `presenceFlowInfo.${topic}`;

// @ts-ignore — global context for cross-tab access
const flowInfo = global.get(flowInfoKey) ?? {};

// Get presence states to check current sensor status
const presenceStatesKey = `presenceStates.${topic}`;
// @ts-ignore
const presenceStates = global.get(presenceStatesKey) || {};
const hasPresence = Object.values(presenceStates).some(state => state === 'on');

// Get the area config for external override policy
// @ts-ignore
const presenceRegistry: PresenceRegistry | undefined = global.get("presenceRegistry");
const areaConfig = presenceRegistry?.areas?.[topic];
const overridePolicy: ExternalOverridePolicy = areaConfig?.externalOverridePolicy || "respect";
const gracePeriod = areaConfig?.externalOverrideGracePeriod || 300; // 5 min default

// Check if any controlled entity was externally modified
function hasExternalOverride(): boolean {
    if (!areaConfig) return false;
    return areaConfig.entities.some(e => isExternallyModified(e.entity_id));
}

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
        global.set(flowInfoKey, flowInfo);
        // @ts-ignore
        msg.payload = null; // Clear payload to prevent turn_off
    } else if (overridePolicy === "respect" && hasExternalOverride()) {
        // External override detected and policy says respect it — skip turn-off
        flowInfo.state = PresenceState.OFF;
        flowInfo.coolDownEndTime = null;
        flowInfo.delay = 0;
        // @ts-ignore
        global.set(flowInfoKey, flowInfo);
        // @ts-ignore
        msg.payload = null; // Don't turn off externally-overridden entities
    } else if (overridePolicy === "extend" && hasExternalOverride()) {
        // Extend cooldown by grace period — re-enter PENDING_OFF
        const extensionMs = gracePeriod * 1000;
        flowInfo.state = PresenceState.PENDING_OFF;
        flowInfo.coolDownEndTime = Date.now() + extensionMs;
        flowInfo.delay = extensionMs;
        // @ts-ignore
        global.set(flowInfoKey, flowInfo);
        // Clear the external modification since we're extending
        if (areaConfig) {
            areaConfig.entities.forEach(e => clearExternalModification(e.entity_id));
        }
        // Re-send the turn_off with the new delay (trigger node will handle it)
        // @ts-ignore
        msg.delay = extensionMs;
        // Keep payload — it will be delayed again by the trigger node
    } else {
        // No motion detected, no external override (or "ignore" policy) - proceed with turn off
        flowInfo.state = PresenceState.OFF;
        flowInfo.coolDownEndTime = null;
        flowInfo.delay = 0;
        // @ts-ignore
        global.set(flowInfoKey, flowInfo);
        // Clear any external modifications for this area's entities since we're turning off
        if (areaConfig) {
            areaConfig.entities.forEach(e => clearExternalModification(e.entity_id));
        }
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
