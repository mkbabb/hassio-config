/**
 * Sleep Mode - triggered by input_select.awake_status → "asleep"
 *
 * Node wiring:
 *   [state-changed: input_select.awake_status → "asleep"]
 *     → [function: this]
 *     → [switch: msg.payload != null]
 *     → [split] → [api-call-service]
 *
 * Actions:
 *   1. Turn off all lights (excluding blacklisted)
 *   2. Lock all doors (if closed)
 *   3. Close garage (if no obstruction)
 *   4. Close all blinds
 */

import { getAllEntities, getEntity } from "../utils/entities";
import { filterBlacklistedEntity, getEntityDomain } from "../utils/utils";
import { shouldFilterEntity } from "../utils/static-states";
import { groupActions } from "../utils/service-calls";

// @ts-ignore - Node-RED global
const message = msg;

const LOCKS = ["lock.front_door", "lock.back_door", "lock.garage_door"];
const GARAGE_COVER = "cover.ratgdov25i_4b1c3b_door";
const GARAGE_OBSTRUCTION = "binary_sensor.ratgdov25i_4b1c3b_obstruction";

// Door sensor patterns
function findDoorSensor(lockEntityId: string): Hass.State | null {
    const basename = lockEntityId.replace(/^lock\./, "");
    for (const suffix of ["_door", "_contact", "_open"]) {
        const entity = getEntity(`binary_sensor.${basename}${suffix}`);
        if (entity) return entity;
    }
    return null;
}

const actions: Partial<Hass.Action>[] = [];
const log: string[] = [];

// 1. Turn off all lights that are currently on (excluding blacklisted + presence-tracked)
const allEntities = getAllEntities();
if (allEntities) {
    for (const [entityId, entity] of Object.entries(allEntities)) {
        if (getEntityDomain(entityId) !== "light") continue;
        if (entity.state !== "on") continue;
        if (!filterBlacklistedEntity(entity)) continue;
        if (shouldFilterEntity(entityId, { checkBlacklist: true, checkStaticState: false, namespace: "presence" })) continue;

        actions.push({
            action: "homeassistant.turn_off",
            target: { entity_id: entityId }
        });
    }
    log.push(`${actions.length} lights to turn off`);
}

// 2. Lock all doors (if door sensor says closed or no sensor exists)
for (const lockId of LOCKS) {
    const lock = getEntity(lockId);
    if (!lock || lock.state === "locked") continue;

    const doorSensor = findDoorSensor(lockId);
    const doorOpen = doorSensor?.state === "on";

    if (doorOpen) {
        // @ts-ignore
        node.warn(`Sleep mode: ${lockId} door is open, skipping lock`);
        log.push(`${lockId}: door open, skipped`);
    } else {
        actions.push({
            action: "lock.lock",
            target: { entity_id: lockId }
        });
        log.push(`${lockId}: locking`);
    }
}

// 3. Close garage cover (check obstruction directly)
const garageCover = getEntity(GARAGE_COVER);
if (garageCover && garageCover.state !== "closed") {
    const obstruction = getEntity(GARAGE_OBSTRUCTION);
    if (obstruction?.state === "on") {
        // @ts-ignore
        node.warn("Sleep mode: garage door obstructed, skipping close");
        log.push("garage: obstructed, skipped");
    } else {
        actions.push({
            action: "cover.close_cover",
            target: { entity_id: GARAGE_COVER }
        });
        log.push("garage: closing");
    }
}

// 4. Close all blinds
if (allEntities) {
    for (const [entityId, entity] of Object.entries(allEntities)) {
        if (getEntityDomain(entityId) !== "cover") continue;
        if (!(/blinds/i.test(entityId))) continue;
        if (entity.state === "closed") continue;

        actions.push({
            action: "cover.close_cover",
            target: { entity_id: entityId }
        });
        log.push(`${entityId}: closing`);
    }
}

if (log.length > 0) {
    // @ts-ignore
    node.warn(`Sleep mode: ${log.join("; ")}`);
}

// @ts-ignore
msg.payload = actions.length > 0 ? groupActions(actions) : null;
