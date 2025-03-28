// Smart Action Filter: Only process entities that need changes
// Takes original action payload and current states, outputs filtered action

// Import utility functions from the path you specified
//@ts-ignore
import { deepEqual, getEntityDomain } from "../utils/utils";

// Get original action and states from joined message
//@ts-ignore
const originalMsg = flow.get("original_action_msg"); // Original action message
//@ts-ignore
const currentStates = msg.payload; // Entity states from join node

// Extract action details

const action = originalMsg.action;
const targetEntities = originalMsg?.target?.entity_id || [];
const actionData = originalMsg?.data || {};

// Extract domain and service
const [domain, service] = action.split(".");

// Determine expected state based on service
let expectedState = null;

if (service === "turn_on") {
    expectedState = "on";
} else if (service === "turn_off") {
    expectedState = "off";
} else if (actionData.state !== undefined) {
    expectedState = actionData.state;
}

// Filter entities that need changes
const changedEntities = [];

// Process each target entity
for (const entityId of targetEntities) {
    const currentState = currentStates[entityId];

    // If we can't get the state, include entity to be safe
    if (!currentState) {
        changedEntities.push(entityId);
        //@ts-ignore
        node.status({ shape: "ring", fill: "yellow", text: `Unknown: ${entityId}` });
        continue;
    }

    // Check if state needs to change
    let needsUpdate = false;

    // Compare basic state (on/off)
    if (
        expectedState !== null &&
        String(currentState.state) !== String(expectedState)
    ) {
        needsUpdate = true;
    }

    // If state is already correct, check attributes
    if (!needsUpdate && Object.keys(actionData).length > 0) {
        // Compare attributes
        for (const key in actionData) {
            if (key === "state") continue; // Skip state, already checked

            const currentValue = currentState.attributes?.[key];
            const desiredValue = actionData[key];

            // If attribute exists but doesn't match OR is missing
            if (
                (currentValue !== undefined &&
                    !deepEqual(currentValue, desiredValue)) ||
                (currentValue === undefined && desiredValue !== undefined)
            ) {
                needsUpdate = true;
                break;
            }
        }
    }

    // Add to list if update needed
    if (needsUpdate) {
        changedEntities.push(entityId);
        //@ts-ignore
        node.status({ fill: "green", shape: "dot", text: `Change: ${entityId}` });
    }
}

// Create output message
if (changedEntities.length === 0) {
    // No entities need changes
    //@ts-ignore
    node.status({ fill: "grey", shape: "dot", text: "No changes needed" });
    //@ts-ignore
    msg = null; // Send nothing downstream
} else {
    // Create new output message with only entities that need changes
    //@ts-ignore
    msg = {
        payload: {
            action: action,
            target: {
                entity_id: changedEntities
            },
            data: actionData
        }
    };

    //@ts-ignore
    node.status({
        fill: "green",
        shape: "dot",
        text: `Updating ${changedEntities.length} entities`
    });
}
