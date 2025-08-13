import { setStaticState, getStaticStates } from "../utils/static-states";

// @ts-ignore
const payload = msg.payload;

// Set the static state for this entity in the 'plants' namespace
setStaticState(payload.entity_id, payload.state, 'plants');

// Get all static states for the plants namespace for debugging/output
const plantStates = getStaticStates('plants');

// @ts-ignore
msg.staticStates = { plants: plantStates };
