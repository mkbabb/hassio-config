/**
 * Night Auto-Lock
 * Fires every 5 minutes via inject node. During sleep window (awake_status = "asleep"),
 * enforces locking on a 30-minute cycle with a 10-minute warning notification.
 *
 * Cycle (repeats every 30 min while asleep):
 *   t=0:  Enforce — lock all doors + close garage (skip ajar/obstructed)
 *   t=20: Warn — notify about anything still unlocked/open that WILL be locked at t=30
 *   t=30: Enforce again (new cycle)
 *
 * Node wiring:
 *   [inject: every 5min]
 *     → [function: this]
 *     ├── output 1: [switch: payload != null] → [split] → [api-call-service]
 *     └── output 2: [switch: notification != null] → [api-call-service: notify]
 *
 * Gate checks:
 *   - input_boolean.night_auto_lock must be "on"
 *   - input_select.awake_status must be "asleep"
 */

import { getEntity } from "../utils/entities";
import { groupActions } from "../utils/service-calls";
import { getEntityBasename } from "../utils/utils";

// @ts-ignore - Node-RED global
const message = msg;

const ENFORCE_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes
const WARN_OFFSET_MS = 20 * 60 * 1000;      // 20 minutes into cycle
const STATE_KEY = "nightAutoLockState";

const LOCKS = ["lock.front_door", "lock.back_door", "lock.garage_door"];
const GARAGE_COVER = "cover.ratgdov25i_4b1c3b_door";
const GARAGE_OBSTRUCTION = "binary_sensor.ratgdov25i_4b1c3b_obstruction";

interface CycleState {
    lastEnforce: number;
    warned: boolean;
}

/** Find the door contact/open sensor for a lock by basename convention */
function findDoorSensor(lockEntityId: string): Hass.State | null {
    const basename = getEntityBasename(lockEntityId);
    for (const suffix of ["_door", "_contact", "_open"]) {
        const entity = getEntity(`binary_sensor.${basename}${suffix}`);
        if (entity) return entity;
    }
    return null;
}

/** Check if a door/cover is ajar or obstructed (unsafe to lock/close) */
function isAjar(entityId: string): boolean {
    if (entityId === GARAGE_COVER) {
        const obstruction = getEntity(GARAGE_OBSTRUCTION);
        return obstruction?.state === "on";
    }
    const doorSensor = findDoorSensor(entityId);
    return doorSensor?.state === "on";
}

/** Get friendly name for an entity */
function friendlyName(entityId: string): string {
    const entity = getEntity(entityId);
    return (entity?.attributes as any)?.friendly_name || entityId;
}

/** Find all lockable items that are currently unlocked/open and not ajar */
function findActionableItems(): { entityId: string; action: string }[] {
    const items: { entityId: string; action: string }[] = [];

    for (const lockId of LOCKS) {
        const lock = getEntity(lockId);
        if (!lock || lock.state === "locked") continue;
        if (isAjar(lockId)) continue;
        items.push({ entityId: lockId, action: "lock.lock" });
    }

    const garage = getEntity(GARAGE_COVER);
    if (garage && garage.state !== "closed" && !isAjar(GARAGE_COVER)) {
        items.push({ entityId: GARAGE_COVER, action: "cover.close_cover" });
    }

    return items;
}

// Gate checks
const autoLockEnabled = getEntity("input_boolean.night_auto_lock");
const awakeStatus = getEntity("input_select.awake_status");

if (autoLockEnabled?.state !== "on" || awakeStatus?.state !== "asleep") {
    // Not in sleep window — reset cycle state so next sleep starts fresh
    // @ts-ignore
    global.set(STATE_KEY, null);
    // @ts-ignore
    msg.payload = null;
    // @ts-ignore
    msg.notification = null;
} else {
    const now = Date.now();

    // @ts-ignore
    let cycle: CycleState | null = global.get(STATE_KEY);
    if (!cycle) {
        // First tick of sleep window — enforce immediately
        cycle = { lastEnforce: 0, warned: false };
    }

    const elapsed = now - cycle.lastEnforce;
    const actions: Partial<Hass.Action>[] = [];
    let notification: any = null;

    if (elapsed >= ENFORCE_INTERVAL_MS) {
        // === ENFORCE: lock everything that's unlocked and not ajar ===
        const items = findActionableItems();
        for (const item of items) {
            actions.push({ action: item.action, target: { entity_id: item.entityId } });
        }

        cycle.lastEnforce = now;
        cycle.warned = false;

    } else if (elapsed >= WARN_OFFSET_MS && !cycle.warned) {
        // === WARN: notify about items that will be locked in ~10 min ===
        const items = findActionableItems();
        if (items.length > 0) {
            const names = items.map(i => friendlyName(i.entityId));
            const verb = items.length === 1 ? "will be" : "will all be";
            notification = {
                action: "notify.mobile_app_forky",
                data: {
                    title: "Night Security",
                    message: `${names.join(", ")} ${verb} locked in ~10 min`,
                    data: {
                        push: { category: "night-security" }
                    }
                }
            };
        }
        cycle.warned = true;
    }

    // @ts-ignore
    global.set(STATE_KEY, cycle);

    // Output 1: grouped lock/cover actions
    // @ts-ignore
    msg.payload = actions.length > 0 ? groupActions(actions) : null;

    // Output 2: iOS notification
    // @ts-ignore
    msg.notification = notification;
}
