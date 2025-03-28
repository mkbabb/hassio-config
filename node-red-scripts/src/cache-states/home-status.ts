// State change debouncer with hybrid immediate/delayed trigger
// Store state in context to persist between calls

// Constants for configuration
const STABLE_PERIOD_MS = 5 * 60 * 1000; // 5 minutes
const DEBOUNCE_DELAY_MS = 30 * 1000; // 30 seconds

//@ts-ignore
const message = msg;

// Get stored values from flow or node context
//@ts-ignore
const lastState = flow.get("home_status_last_state") || null;
//@ts-ignore
const lastChangeTime = flow.get("home_status_last_change_time") || 0;
//@ts-ignore
const pendingTimeout = flow.get("home_status_pending_timeout") || null;

// Current values
const currentState = message.payload;
const currentTime = Date.now();
const timeSinceLastChange = currentTime - lastChangeTime;

// Process state change and return appropriate message
function processStateChange() {
    // Clear any pending timeout if it exists
    if (pendingTimeout) {
        clearTimeout(pendingTimeout);
        //@ts-ignore
        flow.set("home_status_pending_timeout", null);
    }

    // Logic for state changes
    if (currentState !== lastState) {
        // Update last state
        //@ts-ignore
        flow.set("home_status_last_state", currentState);
        //@ts-ignore
        flow.set("home_status_last_change_time", currentTime);

        if (timeSinceLastChange > STABLE_PERIOD_MS) {
            // If stable for 5+ minutes, trigger immediately
            //@ts-ignore
            node.status({ fill: "green", shape: "dot", text: "Immediate trigger" });
            return {
                topic: "home_status_change",
                payload: currentState,
                immediate: true
            };
        } else {
            // Recent change, set a timeout for 30 seconds
            //@ts-ignore
            node.status({ fill: "yellow", shape: "ring", text: "Waiting 30s" });

            // Create a timeout that will check state after 30 seconds
            const timeout = setTimeout(() => {
                // Get the latest state
                //@ts-ignore
                const latestState = flow.get("home_status_last_state");
                // Only trigger if state is still the same as when we started waiting
                if (latestState === currentState) {
                    // Send a message to the next node
                    //@ts-ignore
                    node.send({
                        topic: "home_status_change",
                        payload: latestState,
                        delayed: true
                    });
                    //@ts-ignore
                    node.status({
                        fill: "blue",
                        shape: "dot",
                        text: "Delayed trigger"
                    });
                } else {
                    //@ts-ignore
                    node.status({
                        fill: "grey",
                        shape: "ring",
                        text: "State changed during wait"
                    });
                }
                // Clear the saved timeout
                //@ts-ignore
                flow.set("home_status_pending_timeout", null);
            }, DEBOUNCE_DELAY_MS);

            // Store timeout reference
            //@ts-ignore
            flow.set("home_status_pending_timeout", timeout);
            return null;
        }
    } else {
        // No state change
        //@ts-ignore
        node.status({ fill: "grey", shape: "dot", text: "No change" });
        return null;
    }
}

// Set msg to the result of processing the state change
// The compiler will add "return msg;" at the end
// @ts-ignore
msg = processStateChange();
