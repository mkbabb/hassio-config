/**
 * Presence Registry Seeder
 * Seeds the presenceRegistry flow context from static area definitions.
 * Also registers presence-tracked entities in the "presence" namespace blacklist.
 *
 * Node wiring:
 *   [inject: once on deploy] → [function: this]
 *
 * Runs once on deploy. Idempotent: preserves enabled toggles and dynamic areas.
 */

import type { PresenceAreaConfig, PresenceRegistry } from "./types";
import { clearNamespace, addToBlacklist } from "../utils/static-states";
import { filterBlacklistedEntity } from "../utils/utils";

const PRESENCE_NAMESPACE = "presence";

// Static area definitions extracted from Node-RED flow wiring
// (10 subflow instances on the Presence flow tab)
const STATIC_AREAS: PresenceAreaConfig[] = [
    {
        topic: "bonus_room",
        sensors: [
            "binary_sensor.bonus_room_motion_sensor_2",
            "binary_sensor.bonus_room_motion_sensor_occupancy"
        ],
        entities: [],
        coolDown: 600,
        enabled: true,
        createdAt: "",
        updatedAt: ""
    },
    {
        topic: "downstairs_bathroom",
        sensors: [
            "binary_sensor.downstairs_bathroom_motion_sensor_2",
            "binary_sensor.downstairs_bathroom_motion_sensor_occupancy"
        ],
        entities: [{ entity_id: "light.downstairs_bathroom_light" }],
        coolDown: 600,
        enabled: true,
        createdAt: "",
        updatedAt: ""
    },
    {
        topic: "garage",
        sensors: [
            "binary_sensor.garage_entry_door_door",
            "binary_sensor.garage_motion_sensor",
            "binary_sensor.ratgdov25i_4b1c3b_motion",
            "binary_sensor.ratgdov25i_4b1c3b_obstruction"
        ],
        entities: [],
        coolDown: 600,
        enabled: true,
        createdAt: "",
        updatedAt: ""
    },
    {
        topic: "guest_bathroom",
        sensors: [
            "binary_sensor.guest_bathroom_motion_sensor"
        ],
        entities: [],
        coolDown: 600,
        enabled: true,
        createdAt: "",
        updatedAt: ""
    },
    {
        topic: "guest_bedroom",
        sensors: [
            "binary_sensor.guest_bedroom_motion_sensor"
        ],
        entities: [],
        coolDown: 600,
        enabled: true,
        createdAt: "",
        updatedAt: ""
    },
    {
        topic: "laundry_room",
        sensors: [
            "binary_sensor.garage_entry_door_door",
            "binary_sensor.laundry_room_motion_sensor_2",
            "binary_sensor.laundry_room_motion_sensor_occupancy"
        ],
        entities: [{ entity_id: "light.laundry_room_light" }],
        coolDown: 600,
        enabled: true,
        createdAt: "",
        updatedAt: ""
    },
    {
        topic: "master_bathroom",
        sensors: [
            "binary_sensor.master_bathroom_motion_sensor_2",
            "binary_sensor.master_bathroom_motion_sensor_3",
            "binary_sensor.master_bathroom_motion_sensor_occupancy"
        ],
        entities: [],
        coolDown: 600,
        enabled: true,
        createdAt: "",
        updatedAt: ""
    },
    {
        topic: "plant_room",
        sensors: [
            "binary_sensor.plant_room_motion_sensor_2",
            "binary_sensor.plant_room_motion_sensor_occupancy"
        ],
        entities: [],
        coolDown: 600,
        enabled: true,
        createdAt: "",
        updatedAt: ""
    },
    {
        topic: "upstairs_hall",
        sensors: [
            "binary_sensor.stairwell_motion_sensor_occupancy_2",
            "binary_sensor.upstairs_hall_motion_sensor_occupancy"
        ],
        entities: [
            { entity_id: "light.upstairs_hallway_lights" },
            { entity_id: "light.flower_lamp" }
        ],
        coolDown: 600,
        enabled: true,
        createdAt: "",
        updatedAt: ""
    }
];

// Seed registry (idempotent upsert, same pattern as schedule registry)
const REGISTRY_KEY = "presenceRegistry";

// @ts-ignore - Node-RED global context
const existing: PresenceRegistry | undefined = global.get(REGISTRY_KEY);
const now = new Date().toISOString();

const registry: PresenceRegistry = existing ?? {
    version: 1,
    areas: {},
    lastSeeded: null
};

// Upsert static areas — preserve enabled toggle if already set
for (const area of STATIC_AREAS) {
    const prev = registry.areas[area.topic];
    registry.areas[area.topic] = {
        ...area,
        enabled: prev ? prev.enabled : true,
        createdAt: prev?.createdAt || now,
        updatedAt: now
    };
}

registry.lastSeeded = now;

// @ts-ignore
global.set(REGISTRY_KEY, registry);

// Register presence-tracked entities in the "presence" namespace blacklist.
// This makes shouldFilterEntity() return true for these entities,
// which the schedule engine (already calls shouldFilterEntity at line 339)
// and cache-states (modified in 4f) will respect.
clearNamespace(PRESENCE_NAMESPACE);
for (const area of Object.values(registry.areas)) {
    if (!area.enabled) continue;
    for (const tracked of area.entities) {
        // Only register entities that survive the global regex blacklist
        // (don't register grow lights that happen to be in a presence area)
        if (filterBlacklistedEntity(tracked.entity_id)) {
            addToBlacklist(tracked.entity_id, PRESENCE_NAMESPACE);
        }
    }
}
