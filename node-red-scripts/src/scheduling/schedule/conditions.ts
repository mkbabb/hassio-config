/**
 * Schedule condition evaluation
 *
 * Evaluates conditions like presence state and entity states
 * to determine if a schedule should be active
 */

import { getEntity } from "../../utils/entities";
import { PRESENCE_STATE_ENTITY_ID } from "../types";
import type { ScheduleCondition } from "../types";

/**
 * Evaluates schedule conditions against current state
 *
 * @param conditions - Array of conditions to check (presence, entity states)
 * @param msg - Node-RED message for context
 * @returns true if all conditions pass or no conditions defined
 */
export function checkConditions(
    conditions: ScheduleCondition[] | undefined,
    msg: any
): boolean {
    if (!conditions || conditions.length === 0) {
        return true;
    }

    // Use getEntity for cleaner direct access
    const presenceEntity = getEntity(PRESENCE_STATE_ENTITY_ID);
    const presenceState = presenceEntity?.state;

    return conditions.every((condition) => {
        switch (condition.type) {
            case "presence":
                return presenceState === condition.value;
            case "state":
                if (!condition.entity_id) return true;
                const entity = getEntity(condition.entity_id);
                return entity?.state === condition.value;
            default:
                return true;
        }
    });
}
