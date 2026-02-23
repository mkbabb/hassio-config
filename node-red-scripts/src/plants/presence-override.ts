/**
 * Presence Override for Plant Shelf Grow Lights
 *
 * Standalone chain on the Plants tab that watches bonus room presence sensor directly.
 * When motion detected: sets static states and outputs turn_on actions.
 * When motion clears: outputs entity list with delay for trigger node (cooldown).
 *
 * Wired from state-changed (binary_sensor) → this node → switch (presenceState)
 *   → "on": api-call-service (immediate turn_on)
 *   → "pending_off": trigger (msg.delay ms) → remove-override
 */

import { setStaticState, hasStaticState } from "../utils/static-states";
import { groupActions } from "../utils/service-calls";

// Sensor → room mapping
const SENSOR_TO_ROOM: Record<string, string> = {
    "binary_sensor.bonus_room_motion_sensor_occupancy": "bonus_room"
};

// Room → entities to override when presence is detected
const PRESENCE_OVERRIDES: Record<string, string[]> = {
    "bonus_room": [
        "light.pikachu_grow_light",
        "switch.pikachu_grow_light_switch",
        "switch.grow_light_bookshelf_1_switch"
    ]
};

const NAMESPACE = "plants";
const COOLDOWN_MS = 10 * 60 * 1000; // 10 minutes

// @ts-ignore
const message = msg;

// Read from state-changed node output
const sensorState: string = message.payload; // "on" or "off"
const entityId: string = message.data?.entity_id || "";

const room = SENSOR_TO_ROOM[entityId];
const entities = room ? PRESENCE_OVERRIDES[room] : undefined;

if (!entities || entities.length === 0) {
    // Not a sensor we care about — stop
    // @ts-ignore
    msg.payload = null;
} else if (sensorState === "on") {
    // Motion detected — set static states and output turn_on actions
    // @ts-ignore
    msg.presenceState = "on";

    for (const eid of entities) {
        setStaticState(eid, "on", NAMESPACE);
    }

    const actions: Partial<Hass.Action>[] = entities.map((eid) => ({
        action: "homeassistant.turn_on",
        target: { entity_id: eid }
    }));

    const grouped = groupActions(actions);
    // @ts-ignore
    msg.payload = grouped[0] || null;
} else if (sensorState === "off") {
    // Motion cleared — queue removal with cooldown
    // @ts-ignore
    msg.presenceState = "pending_off";

    // Only output if we actually have overrides active
    const hasOverrides = entities.some((eid) => hasStaticState(eid, NAMESPACE));

    if (hasOverrides) {
        // Pass entity list for trigger node; msg.delay drives the trigger duration
        // @ts-ignore
        msg.payload = entities.map((eid) => ({ entity_id: eid }));
        // @ts-ignore
        msg.delay = COOLDOWN_MS;
    } else {
        // No overrides active — nothing to do
        // @ts-ignore
        msg.payload = null;
    }
} else {
    // Unknown state — stop
    // @ts-ignore
    msg.payload = null;
}
