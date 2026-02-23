/**
 * Remove Presence Override for Plant Shelf Grow Lights
 *
 * Fires after the trigger node's cooldown expires.
 * Removes static state overrides so the scheduler resumes control.
 * Does NOT explicitly turn off — the scheduler decides the correct state
 * on its next cycle based on the current schedule window.
 */

import { removeStaticState } from "../utils/static-states";

const NAMESPACE = "plants";

// The entities to clear come from the upstream presence-override payload
const SHELF_ENTITIES = [
    "light.pikachu_grow_light",
    "switch.pikachu_grow_light_switch",
    "switch.grow_light_bookshelf_1_switch"
];

// Remove static states for all shelf entities
for (const entityId of SHELF_ENTITIES) {
    removeStaticState(entityId, NAMESPACE);
}

// Output null — no explicit action, let scheduler handle state
// @ts-ignore
msg.payload = null;
