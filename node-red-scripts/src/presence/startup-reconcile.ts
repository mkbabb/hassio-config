/**
 * Presence Startup Reconciliation
 * Runs once ~20s after deploy/restart (after seed-registry at 5s).
 *
 * Reconciles physical entity states with the presence DFA:
 *   1. Reads actual HA sensor states for each area
 *   2. Reads actual HA entity states (lights, etc.)
 *   3. Checks presence conditions (day/night, home/away)
 *   4. Decision matrix per area:
 *      - Sensors ON + conditions met → initialize DFA to "on", keep entities on
 *      - Sensors ON + conditions NOT met → DFA "on" but turn entities off
 *      - Sensors OFF + entities ON → orphaned — turn entities off
 *      - Sensors OFF + entities OFF → no action needed
 *
 * This ensures lights don't stay on after restarts when nobody is in the room,
 * and that conditions (like night mode) are enforced immediately on startup.
 *
 * Node wiring:
 *   [inject: once on deploy, 20s delay] → [function: this] → [call-service]
 */

import type { PresenceAreaConfig, PresenceRegistry } from "./types";
import { getSensorEntityId, normalizeSensorConfig } from "./types";
import { getEntity } from "../utils/entities";
import { groupActions } from "../utils/service-calls";
import { filterBlacklistedEntity } from "../utils/utils";

const REGISTRY_KEY = "presenceRegistry";

// @ts-ignore - Node-RED global
const message = msg;

// Check if all presence conditions are met for an area
const checkPresenceConditions = (area: PresenceAreaConfig): boolean => {
    if (!area.conditions || area.conditions.length === 0) return true;
    return area.conditions.every(c => {
        const entity = getEntity(c.entity_id);
        if (!entity) return false;
        const states = Array.isArray(c.state) ? c.state : [c.state];
        return states.includes(entity.state);
    });
};

// Read actual sensor state from HA
const readSensorState = (sensorId: string): string => {
    const entity = getEntity(sensorId);
    return entity?.state || "unknown";
};

// Read actual entity state from HA
const readEntityState = (entityId: string): string => {
    const entity = getEntity(entityId);
    return entity?.state || "unknown";
};

// @ts-ignore
const registry: PresenceRegistry | undefined = global.get(REGISTRY_KEY);

if (!registry) {
    // @ts-ignore
    node.warn("Startup reconcile: no presence registry found");
    // @ts-ignore
    msg.payload = null;
} else {
    const actions: Partial<Hass.Service & Hass.Action>[] = [];
    const reconciled: string[] = [];
    const initialized: string[] = [];
    const skipped: string[] = [];

    for (const area of Object.values(registry.areas)) {
        if (!area.enabled) {
            skipped.push(`${area.topic}: disabled`);
            continue;
        }

        // Read actual sensor states from HA
        const sensorStates: Record<string, string> = {};
        for (const sensorCfg of area.sensors) {
            const sensorId = getSensorEntityId(sensorCfg);
            sensorStates[sensorId] = readSensorState(sensorId);
        }

        // Determine aggregate sensor state (only level sensors for presence)
        const sensorConfigs = area.sensors.map(s => normalizeSensorConfig(s));
        const levelSensorStates = Object.entries(sensorStates)
            .filter(([id]) => {
                const cfg = sensorConfigs.find(s => s.entity_id === id);
                return !cfg || cfg.triggerMode !== "edge";
            })
            .map(([, state]) => state);

        const anySensorOn = levelSensorStates.some(s => s === "on");

        // Read actual entity states from HA
        const entityStates: Record<string, string> = {};
        const filteredEntities: string[] = [];
        for (const tracked of area.entities) {
            const state = readEntityState(tracked.entity_id);
            entityStates[tracked.entity_id] = state;
            if (filterBlacklistedEntity({ entity_id: tracked.entity_id } as any)) {
                filteredEntities.push(tracked.entity_id);
            }
        }

        const anyEntityOn = filteredEntities.some(id =>
            entityStates[id] === "on"
        );

        // Check conditions
        const conditionsMet = checkPresenceConditions(area);

        // Read current DFA state (may be default "off" after restart)
        const flowInfoKey = `presenceFlowInfo.${area.topic}`;
        const presenceStatesKey = `presenceStates.${area.topic}`;
        // @ts-ignore
        let flowInfo = global.get(flowInfoKey) || {
            state: "off",
            prevState: "off",
            prevPrevState: "off",
            lastOn: null,
            lastOff: null,
            delay: 0,
            coolDownEndTime: null
        };

        // === PRE-CHECK: Stale pending_off with expired cooldown ===
        // Defense-in-depth: if area is stuck in pending_off with expired cooldown,
        // force-clear to off regardless of sensor/entity state. The cooldown ticker
        // sweeper is the primary fix, but this catches cases on restart.
        const now = Date.now();
        if (flowInfo.state === "pending_off" && (!flowInfo.coolDownEndTime || now >= flowInfo.coolDownEndTime)) {
            flowInfo.state = "off";
            flowInfo.prevState = "pending_off";
            flowInfo.lastOff = now;
            flowInfo.delay = 0;
            flowInfo.coolDownEndTime = null;

            // @ts-ignore
            global.set(presenceStatesKey, sensorStates);
            // @ts-ignore
            global.set(flowInfoKey, flowInfo);

            // Turn off any entities that are still on
            for (const entityId of filteredEntities) {
                if (entityStates[entityId] === "on") {
                    actions.push({
                        action: "homeassistant.turn_off",
                        target: { entity_id: entityId }
                    });
                }
            }

            reconciled.push(`${area.topic}: stale pending_off (expired cooldown) → DFA=off, entities OFF`);
            continue;
        }

        // === RECONCILIATION LOGIC ===

        if (anySensorOn && conditionsMet) {
            // Room is occupied and conditions are met → initialize DFA to "on"
            flowInfo.state = "on";
            flowInfo.prevState = "off";
            flowInfo.lastOn = Date.now();
            flowInfo.lastOff = null;
            flowInfo.delay = 0;
            flowInfo.coolDownEndTime = null;

            // Persist sensor states so DFA has baseline
            // @ts-ignore
            global.set(presenceStatesKey, sensorStates);
            // @ts-ignore
            global.set(flowInfoKey, flowInfo);

            initialized.push(`${area.topic}: sensors ON, conditions met → DFA=on`);

        } else if (anySensorOn && !conditionsMet) {
            // Room is occupied but conditions not met (e.g., night mode)
            // Initialize DFA to "on" (track presence) but turn entities off
            flowInfo.state = "on";
            flowInfo.prevState = "off";
            flowInfo.lastOn = Date.now();
            flowInfo.lastOff = null;
            flowInfo.delay = 0;
            flowInfo.coolDownEndTime = null;

            // @ts-ignore
            global.set(presenceStatesKey, sensorStates);
            // @ts-ignore
            global.set(flowInfoKey, flowInfo);

            // Turn off entities (conditions not met)
            for (const entityId of filteredEntities) {
                if (entityStates[entityId] === "on") {
                    actions.push({
                        action: "homeassistant.turn_off",
                        target: { entity_id: entityId }
                    });
                }
            }

            reconciled.push(`${area.topic}: sensors ON but conditions NOT met → DFA=on, entities OFF`);

        } else if (!anySensorOn && anyEntityOn) {
            // No presence but entities are on → orphaned, turn off
            flowInfo.state = "off";
            flowInfo.prevState = "off";
            flowInfo.lastOff = Date.now();
            flowInfo.lastOn = null;
            flowInfo.delay = 0;
            flowInfo.coolDownEndTime = null;

            // @ts-ignore
            global.set(presenceStatesKey, sensorStates);
            // @ts-ignore
            global.set(flowInfoKey, flowInfo);

            for (const entityId of filteredEntities) {
                if (entityStates[entityId] === "on") {
                    actions.push({
                        action: "homeassistant.turn_off",
                        target: { entity_id: entityId }
                    });
                }
            }

            reconciled.push(`${area.topic}: sensors OFF, entities ON → orphaned, turning off`);

        } else {
            // Sensors off, entities off — just ensure DFA state and sensor states are persisted
            // @ts-ignore
            global.set(presenceStatesKey, sensorStates);
            // @ts-ignore
            global.set(flowInfoKey, flowInfo);

            skipped.push(`${area.topic}: already consistent`);
        }
    }

    // @ts-ignore
    node.warn(`Startup reconcile: ${reconciled.length} reconciled, ${initialized.length} initialized, ${skipped.length} skipped, ${actions.length} actions`);

    if (reconciled.length > 0) {
        // @ts-ignore
        node.warn(`Startup reconcile details: ${reconciled.join("; ")}`);
    }
    if (initialized.length > 0) {
        // @ts-ignore
        node.warn(`Startup initialized: ${initialized.join("; ")}`);
    }

    if (actions.length > 0) {
        // @ts-ignore
        msg.payload = groupActions(actions);
    } else {
        // @ts-ignore
        msg.payload = null;
    }

    // @ts-ignore
    msg.reconciliation = {
        reconciled,
        initialized,
        skipped,
        actionCount: actions.length,
        timestamp: new Date().toISOString()
    };
}
