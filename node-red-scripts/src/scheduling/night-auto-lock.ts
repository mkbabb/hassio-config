/**
 * Night Auto-Lock System
 * Fires every 5 minutes via inject node. During sleep window, attempts to
 * lock doors and close garage with safety checks and iOS notifications.
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
 *
 * Rate limiting: 30 min per entity for lock attempts and notifications
 */

import { getEntity } from "../utils/entities";
import { groupActions } from "../utils/service-calls";
import { getEntityBasename } from "../utils/utils";

// @ts-ignore - Node-RED global
const message = msg;

const RATE_LIMIT_MS = 30 * 60 * 1000; // 30 minutes
const STATE_KEY = "nightAutoLockState";

const LOCKS = ["lock.front_door", "lock.back_door", "lock.garage_door"];
const GARAGE_COVER = "cover.ratgdov25i_4b1c3b_door";
const GARAGE_OBSTRUCTION = "binary_sensor.ratgdov25i_4b1c3b_obstruction";

// Door sensor patterns: binary_sensor.{basename}_door, _contact, _open
function findDoorSensor(lockEntityId: string): Hass.State | null {
    const basename = getEntityBasename(lockEntityId);
    for (const suffix of ["_door", "_contact", "_open"]) {
        const entity = getEntity(`binary_sensor.${basename}${suffix}`);
        if (entity) return entity;
    }
    return null;
}

// Gate checks
const autoLockEnabled = getEntity("input_boolean.night_auto_lock");
const awakeStatus = getEntity("input_select.awake_status");

if (autoLockEnabled?.state !== "on" || awakeStatus?.state !== "asleep") {
    // @ts-ignore
    msg.payload = null;
    // @ts-ignore
    msg.notification = null;
} else {
    const now = Date.now();

    // Rate limit state from global context
    // @ts-ignore
    const rateState: Record<string, number> = global.get(STATE_KEY) || {};

    const actions: Partial<Hass.Action>[] = [];
    const notifications: string[] = [];

    function isRateLimited(entityId: string): boolean {
        const last = rateState[entityId];
        return last != null && (now - last) < RATE_LIMIT_MS;
    }

    function recordAction(entityId: string): void {
        rateState[entityId] = now;
    }

    // Check each lock
    for (const lockId of LOCKS) {
        const lock = getEntity(lockId);
        if (!lock || lock.state === "locked") continue;

        const doorSensor = findDoorSensor(lockId);
        const doorOpen = doorSensor?.state === "on";

        if (doorOpen) {
            // Door is ajar — send notification (rate-limited)
            const notifKey = `${lockId}_notification`;
            if (!isRateLimited(notifKey)) {
                const friendlyName = (lock.attributes as any)?.friendly_name || lockId;
                notifications.push(`${friendlyName} is ajar and cannot be locked`);
                recordAction(notifKey);
            }
        } else {
            // Door closed — attempt lock (rate-limited)
            if (!isRateLimited(lockId)) {
                actions.push({
                    action: "lock.lock",
                    target: { entity_id: lockId }
                });
                recordAction(lockId);
            }
        }
    }

    // Check garage cover
    const garageCover = getEntity(GARAGE_COVER);
    if (garageCover && garageCover.state !== "closed") {
        // Check obstruction directly (basename mismatch prevents generic lookup)
        const obstruction = getEntity(GARAGE_OBSTRUCTION);
        const isObstructed = obstruction?.state === "on";

        if (isObstructed) {
            const notifKey = `${GARAGE_COVER}_notification`;
            if (!isRateLimited(notifKey)) {
                notifications.push("Garage door is obstructed and cannot be closed");
                recordAction(notifKey);
            }
        } else {
            if (!isRateLimited(GARAGE_COVER)) {
                actions.push({
                    action: "cover.close_cover",
                    target: { entity_id: GARAGE_COVER }
                });
                recordAction(GARAGE_COVER);
            }
        }
    }

    // Save rate limit state
    // @ts-ignore
    global.set(STATE_KEY, rateState);

    // Output 1: grouped lock/cover actions
    // @ts-ignore
    msg.payload = actions.length > 0 ? groupActions(actions) : null;

    // Output 2: iOS notification
    if (notifications.length > 0) {
        // @ts-ignore
        msg.notification = {
            action: "notify.mobile_app_forky",
            data: {
                title: "Night Security Check",
                message: notifications.join("\n"),
                data: {
                    push: { category: "night-security" }
                }
            }
        };
    } else {
        // @ts-ignore
        msg.notification = null;
    }
}
