/**
 * Presence Condition Enforcer
 * Auto-enforces presence conditions when global state changes (day/night, home/away).
 *
 * Node wiring:
 *   [state-changed: input_select.day_status] → [delay: 60s] → [function: this] → [call-service]
 *   [state-changed: input_select.home_status] → [delay: 60s] → [function: this] → [call-service]
 *
 * When day_status or home_status changes, waits 60 seconds then:
 *   - For each presence area with conditions:
 *     - If conditions are NO LONGER met AND area is NOT occupied (state != "on")
 *       AND NOT in active cooldown → turn off all entities
 *     - If conditions ARE NOW met AND area IS occupied → turn on entities (re-enable)
 *
 * This prevents lights from staying on after a day→night transition when
 * the area has a condition like { entity_id: "input_select.day_status", state: "day" }.
 */

import type { PresenceAreaConfig, PresenceRegistry } from "./types";
import { getEntity } from "../utils/entities";
import { groupActions } from "../utils/service-calls";
import { filterBlacklistedEntity } from "../utils/utils";
import { clearExternalModificationsForPresenceEntities } from "../utils/static-states";

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

// @ts-ignore
const registry: PresenceRegistry | undefined = global.get(REGISTRY_KEY);

if (!registry) {
    // @ts-ignore
    msg.payload = null;
} else {
    const actions: Partial<Hass.Service & Hass.Action>[] = [];
    const enforced: string[] = [];
    const skipped: string[] = [];

    // Clear external modifications for presence-tracked entities on major transitions.
    // When day/night or home/away changes, previous external state divergence
    // is no longer meaningful — the scheduler should re-enforce freely.
    const externalModsCleared = clearExternalModificationsForPresenceEntities();

    for (const area of Object.values(registry.areas)) {
        if (!area.enabled) {
            skipped.push(`${area.topic}: disabled`);
            continue;
        }

        // Only process areas that HAVE conditions
        if (!area.conditions || area.conditions.length === 0) {
            continue;
        }

        const flowInfoKey = `presenceFlowInfo.${area.topic}`;
        // @ts-ignore
        const flowInfo = global.get(flowInfoKey) || {};
        const currentState = flowInfo.state || "off";

        const conditionsMet = checkPresenceConditions(area);

        if (!conditionsMet) {
            // Conditions NOT met — should enforce off
            // Skip if area is currently occupied (someone is there)
            if (currentState === "on") {
                skipped.push(`${area.topic}: occupied`);
                continue;
            }

            // Skip if in active cooldown (someone was recently there)
            if (currentState === "pending_off" && flowInfo.coolDownEndTime && Date.now() < flowInfo.coolDownEndTime) {
                skipped.push(`${area.topic}: in cooldown`);
                continue;
            }

            // Enforce off — turn off all entities in this area
            const entities = area.entities
                .filter(e => filterBlacklistedEntity({ entity_id: e.entity_id } as any))
                .map(e => e.entity_id);

            if (entities.length > 0) {
                for (const entityId of entities) {
                    actions.push({
                        action: "homeassistant.turn_off",
                        target: { entity_id: entityId }
                    });
                }
                enforced.push(`${area.topic}: off (${entities.length} entities)`);

                // Update flow state to reflect enforcement
                flowInfo.state = "off";
                flowInfo.prevState = currentState;
                flowInfo.lastOff = Date.now();
                flowInfo.delay = 0;
                flowInfo.coolDownEndTime = null;
                // @ts-ignore
                global.set(flowInfoKey, flowInfo);
            }
        }
        // If conditions ARE met and area is occupied, presence.ts already handles turn_on
        // via normal sensor triggers — no action needed here.
    }

    if (actions.length > 0) {
        // @ts-ignore
        msg.payload = groupActions(actions);
    } else {
        // @ts-ignore
        msg.payload = null;
    }

    // @ts-ignore
    msg.conditionEnforcement = {
        enforced,
        skipped,
        externalModsCleared,
        trigger: message.data?.entity_id || "unknown",
        triggerState: message.state || "unknown",
        timestamp: new Date().toISOString()
    };
}
