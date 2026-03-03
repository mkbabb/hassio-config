/**
 * Sleeptime Scene Handler
 * Triggered when scene.sleeptime is activated. Re-applies all sleep-mode actions
 * even if already asleep, and truncates plant schedule if still active.
 *
 * Node wiring:
 *   [state-changed: scene.sleeptime]
 *     → [function: this]
 *     → [switch: payload != null] → [split] → [api-call-service]
 *
 * Actions:
 *   1. Set awake_status to "asleep"
 *   2. Turn off all lights (excluding blacklisted)
 *   3. Lock all doors (if closed)
 *   4. Close garage (if no obstruction)
 *   5. Close all blinds
 *   6. Truncate plant schedule end to now (if end > now)
 */

import { getAllEntities, getEntity } from "../utils/entities";
import { filterBlacklistedEntity, getEntityDomain } from "../utils/utils";
import { shouldFilterEntity } from "../utils/static-states";
import { groupActions } from "../utils/service-calls";
import { getTimeString, timeStringToDate, compareTime } from "../utils/datetime";

// @ts-ignore - Node-RED global
const message = msg;

const LOCKS = ["lock.front_door", "lock.back_door", "lock.garage_door"];
const GARAGE_COVER = "cover.ratgdov25i_4b1c3b_door";
const GARAGE_OBSTRUCTION = "binary_sensor.ratgdov25i_4b1c3b_obstruction";
const PLANTS_SCHEDULE_END = "sensor.plants_global_schedule_end";
const PLANTS_END_INPUT = "input_datetime.plants_global_schedule_end";
const PLANTS_SYNC_SLEEP = "input_boolean.plants_sync_sleep";

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

// 1. Set awake_status to "asleep"
const awakeStatus = getEntity("input_select.awake_status");
if (awakeStatus?.state !== "asleep") {
    actions.push({
        action: "input_select.select_option",
        target: { entity_id: "input_select.awake_status" },
        data: { option: "asleep" }
    });
    log.push("awake_status: setting to asleep");
} else {
    log.push("awake_status: already asleep, re-applying states");
}

// 2. Turn off all lights (excluding blacklisted + presence-tracked)
const allEntities = getAllEntities();
if (allEntities) {
    let lightCount = 0;
    for (const [entityId, entity] of Object.entries(allEntities)) {
        if (getEntityDomain(entityId) !== "light") continue;
        if (entity.state !== "on") continue;
        if (!filterBlacklistedEntity(entity)) continue;
        if (shouldFilterEntity(entityId, { checkBlacklist: true, checkStaticState: false, namespace: "presence" })) continue;

        actions.push({
            action: "homeassistant.turn_off",
            target: { entity_id: entityId }
        });
        lightCount++;
    }
    log.push(`${lightCount} lights to turn off`);
}

// 3. Lock all doors (if door sensor shows closed)
for (const lockId of LOCKS) {
    const lock = getEntity(lockId);
    if (!lock || lock.state === "locked") continue;

    const doorSensor = findDoorSensor(lockId);
    if (doorSensor?.state === "on") {
        // @ts-ignore
        node.warn(`Sleeptime scene: ${lockId} door open, skipping lock`);
        log.push(`${lockId}: door open, skipped`);
    } else {
        actions.push({ action: "lock.lock", target: { entity_id: lockId } });
        log.push(`${lockId}: locking`);
    }
}

// 4. Close garage cover (check obstruction)
const garageCover = getEntity(GARAGE_COVER);
if (garageCover && garageCover.state !== "closed") {
    const obstruction = getEntity(GARAGE_OBSTRUCTION);
    if (obstruction?.state === "on") {
        // @ts-ignore
        node.warn("Sleeptime scene: garage obstructed, skipping");
        log.push("garage: obstructed, skipped");
    } else {
        actions.push({ action: "cover.close_cover", target: { entity_id: GARAGE_COVER } });
        log.push("garage: closing");
    }
}

// 5. Close all blinds
if (allEntities) {
    for (const [entityId, entity] of Object.entries(allEntities)) {
        if (getEntityDomain(entityId) !== "cover") continue;
        if (!(/blinds/i.test(entityId))) continue;
        if (entity.state === "closed") continue;

        actions.push({ action: "cover.close_cover", target: { entity_id: entityId } });
        log.push(`${entityId}: closing`);
    }
}

// 6. Truncate plant schedule end if still in the future
const plantEndSensor = getEntity(PLANTS_SCHEDULE_END);
if (plantEndSensor?.state) {
    const currentTime = getTimeString(); // HH:MM:SS
    const endTimeStr = plantEndSensor.state.substring(0, 5); // HH:MM
    const currentDate = timeStringToDate(currentTime);
    const endDate = timeStringToDate(endTimeStr);

    if (compareTime(endDate, currentDate) > 0) {
        // Plant schedule end is in the future — truncate to now
        // Disable sync so template sensor reads from input_datetime
        actions.push({
            action: "input_boolean.turn_off",
            target: { entity_id: PLANTS_SYNC_SLEEP }
        });
        actions.push({
            action: "input_datetime.set_datetime",
            target: { entity_id: PLANTS_END_INPUT },
            data: { time: currentTime }
        });
        log.push(`plants: truncating end ${endTimeStr} → ${currentTime.substring(0, 5)}`);
    } else {
        log.push(`plants: end ${endTimeStr} already past, no truncation`);
    }
}

if (log.length > 0) {
    // @ts-ignore
    node.warn(`Sleeptime scene: ${log.join("; ")}`);
}

// @ts-ignore
msg.payload = actions.length > 0 ? groupActions(actions) : null;
