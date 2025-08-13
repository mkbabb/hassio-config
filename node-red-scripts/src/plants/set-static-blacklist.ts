import { addToBlacklist, getBlacklist } from "../utils/static-states";

// @ts-ignore
const payload = msg.payload;

// Add the entity to the blacklist in the 'plants' namespace
addToBlacklist(payload.entity_id, 'plants');

// Get the current blacklist for debugging/output
const blacklist = getBlacklist('plants');

// @ts-ignore
msg.staticBlacklist = { plants: blacklist };
