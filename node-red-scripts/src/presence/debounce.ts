/**
 * Simple KISS Debouncing Utility
 */

// @ts-ignore - Node-RED global
const message = msg;
const state = message.state;
const topic = message.topic || message.data?.entity_id;

// Debounce settings
const RESET_DEBOUNCE_TIME = 30000; // 30 seconds

// Check if we're in reset debounce mode
const debounceKey = `resetDebounce.${topic}`;
// @ts-ignore
const debounceInfo = flow.get(debounceKey) || { active: false, startTime: 0 };

const now = Date.now();

// Clear expired debounce
if (debounceInfo.active && (now - debounceInfo.startTime) > RESET_DEBOUNCE_TIME) {
    debounceInfo.active = false;
    debounceInfo.startTime = 0;
}

// Handle reset state
if (state === "reset") {
    if (debounceInfo.active) {
        // Still in debounce - ignore this reset
        // @ts-ignore
        message.state = "ignored";
    } else {
        // First reset - activate debounce
        debounceInfo.active = true;
        debounceInfo.startTime = now;
        // Keep the reset state
    }
}

// Save debounce state
// @ts-ignore
flow.set(debounceKey, debounceInfo);

// Add debug info
// @ts-ignore
message.debounceActive = debounceInfo.active;
// @ts-ignore
message.debounceTimeRemaining = debounceInfo.active ? 
    Math.max(0, RESET_DEBOUNCE_TIME - (now - debounceInfo.startTime)) : 0;