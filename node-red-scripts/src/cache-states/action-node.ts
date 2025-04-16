// Smart Action Filter: Only process entities that need changes
// Takes original action payload and current states, outputs filtered action

// Import utility functions from the path you specified
//@ts-ignore
import { deepEqual, getEntityDomain, domainToService } from "../utils/utils";

// Get original action and states from joined message
//@ts-ignore
const originalMsg = msg.originalPayload; // Original action message
//@ts-ignore
const currentStates: Array<Hass.State> = msg.target; // Entity states from join node

const currentStatesMap = currentStates.reduce((acc, state) => {
    acc[state.entity_id] = state;
    return acc;
}, {});

// Extract action details

const action = originalMsg.action;

const targetEntities = originalMsg?.target?.entity_id || [];

const actionData = originalMsg?.data || {};

// Extract domain and service
const [actionDomain, actionService] = action.split(".");

// Filter entities that need changes
const changedEntities = [];

// Process each target entity
for (const entityId of targetEntities) {
    const currentState = currentStatesMap[entityId];

    // If we can't get the state, include entity to be safe
    if (!currentState) {
        changedEntities.push(entityId);
        //@ts-ignore
        node.status({ shape: "ring", fill: "yellow", text: `Unknown: ${entityId}` });
        continue;
    }

    const currentService = domainToService(currentState, actionDomain);

    // Check if state needs to change
    let needsUpdate = false;

    if (currentService !== actionService) {
        needsUpdate = true;
    }

    // If state is already correct, check attributes
    if (!needsUpdate && Object.keys(actionData).length > 0) {
        // Compare attributes with the action data; for each action data key
        const currentAttributes = currentState.attributes || {};

        needsUpdate = Object.keys(actionData).some((key) => {
            // Check if the key is in the current attributes
            if (key in currentAttributes) {
                // Compare values
                return !deepEqual(currentAttributes[key], actionData[key]);
            }
            // If key is not in current attributes, we need to update
            return true;
        });
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
    msg.payload = null;
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
