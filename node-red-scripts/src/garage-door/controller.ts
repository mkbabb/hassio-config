/**
 * Smart Garage Door Controller
 * 
 * Opens garage door based on Tesla activity patterns:
 * - Departure: Unplug charger + enter car within 2 min
 * - User Present: Detect user in Tesla while home
 * - Motion: Garage/laundry motion + Tesla activity within 30 sec
 * - Arrival: Tesla arrives home with user inside
 * 
 * Safety: Suppressed at night, when asleep, or within 5 min cooldown
 */

import { getEntity } from "../utils/ha-entities";

// Timing Configuration
const CHARGER_WINDOW = 2 * 60 * 1000;  // 2 minutes - Max time between unplugging charger and entering car for departure sequence
const MOTION_WINDOW = 30 * 1000;        // 30 seconds - Max time between motion sensor trigger and Tesla activity for correlation
const COOLDOWN = 5 * 60 * 1000;         // 5 minutes - Minimum time between garage door openings to prevent excessive operations

// Entity IDs centralized for maintainability (DRY - single source of truth)
// All entities used in the automation are defined here to avoid hardcoding throughout
const ENTITIES = {
    garageDoor: "cover.ratgdov25i_4b1c3b_door",
    teslaLocation: "device_tracker.son_of_toast_location_tracker",
    teslaUserPresent: "binary_sensor.son_of_toast_user_present",
    teslaDoors: "binary_sensor.son_of_toast_doors",
    teslaCharger: "binary_sensor.son_of_toast_charger",
    garageMotion: "binary_sensor.garage_motion_sensor",
    laundryMotion: "binary_sensor.laundry_room_motion_sensor_occupancy",
    homeStatus: "input_select.home_status",
    dayStatus: "input_select.day_status",
    awakeStatus: "input_select.awake_status"
};

// @ts-ignore - Node-RED globals
const message = msg;
const topic = message.topic;
const payload = message.payload;

// Load persistent context to track state across multiple trigger events
// This allows correlation of events that happen minutes apart (e.g., unplug then enter car)
type Context = {
    lastChargerConnected: boolean;
    lastChargerDisconnect: number;
    lastMotion: number;
    lastOpen: number;
    lastTeslaLocation: string;
};

// @ts-ignore
let ctx: Context = flow.get("garageDoorState") || {
    lastChargerConnected: false,
    lastChargerDisconnect: 0,
    lastMotion: 0,
    lastOpen: 0,
    lastTeslaLocation: "unknown"
};

// Fetch current states from Home Assistant for decision making
// These states determine both safety conditions and trigger validations
const garageDoor = getEntity(ENTITIES.garageDoor);
const teslaLocation = getEntity(ENTITIES.teslaLocation)?.state;  // Keep for arrival detection only
const userHome = getEntity(ENTITIES.homeStatus)?.state === "home";
const userPresent = getEntity(ENTITIES.teslaUserPresent)?.state === "on";
const doorsOpen = getEntity(ENTITIES.teslaDoors)?.state === "on";
const nightOrAsleep = getEntity(ENTITIES.dayStatus)?.state === "night" || 
                      getEntity(ENTITIES.awakeStatus)?.state === "asleep";

// Determine if garage door can safely open by checking ALL required conditions:
// 1. garageDoor?.state === "closed" - Only open if currently closed (prevent redundant commands)
// 2. userHome - User must be marked as home in HA (prevents opening when away)
// 3. !nightOrAsleep - Suppress during night hours or when user is asleep (quiet hours)
// 4. Date.now() - ctx.lastOpen >= COOLDOWN - Enforce 5-minute cooldown between openings (prevent rapid cycling)
// Note: Removed teslaHome check as location tracker is unreliable
const canOpen = garageDoor?.state === "closed" && 
                userHome && 
                !nightOrAsleep && 
                Date.now() - ctx.lastOpen >= COOLDOWN;

// Process the trigger and determine if we should open
const { shouldOpen, reason } = (() => {
    const now = Date.now();
    let shouldOpen = false;
    let reason = "";
    
    // Always track state changes for correlation
    switch (topic) {
        case ENTITIES.teslaCharger:
            if (ctx.lastChargerConnected && payload === "off") {
                ctx.lastChargerDisconnect = now;
            }
            ctx.lastChargerConnected = payload === "on";
            
            // Only process trigger if conditions allow
            if (canOpen && payload === "off" && (userPresent || doorsOpen)) {
                shouldOpen = true;
                reason = "departure_sequence";
            }
            break;
            
        case ENTITIES.teslaUserPresent:
            if (canOpen && payload === "on") {
                reason = (now - ctx.lastChargerDisconnect < CHARGER_WINDOW) 
                    ? "departure_after_unplug" 
                    : "user_present";
                shouldOpen = true;
            }
            break;
            
        case ENTITIES.teslaDoors:
            if (canOpen && payload === "on") {
                if (now - ctx.lastChargerDisconnect < CHARGER_WINDOW) {
                    shouldOpen = true;
                    reason = "departure_doors";
                } else if (now - ctx.lastMotion < MOTION_WINDOW) {
                    shouldOpen = true;
                    reason = "motion_then_doors";
                }
            }
            break;
            
        case ENTITIES.garageMotion:
        case ENTITIES.laundryMotion:
            if (payload === "on") {
                ctx.lastMotion = now;
                if (canOpen && (userPresent || doorsOpen)) {
                    shouldOpen = true;
                    reason = "motion_with_activity";
                }
            }
            break;
            
        case ENTITIES.teslaLocation:
            if (ctx.lastTeslaLocation !== "home" && payload === "home") {
                if (canOpen && userPresent) {
                    shouldOpen = true;
                    reason = "arrival";
                }
            }
            ctx.lastTeslaLocation = payload;
            break;
    }
    
    // Update last open time if we're opening
    if (shouldOpen) {
        ctx.lastOpen = now;
    }
    
    return { shouldOpen, reason };
})();

// Persist context for next trigger event (survives across Node-RED message flows)
// @ts-ignore
flow.set("garageDoorState", ctx);

// Prepare Home Assistant service call (null payload means no action taken)
message.payload = shouldOpen ? {
    action: "cover.open_cover",
    target: { entity_id: ENTITIES.garageDoor }
} : null;

// Comprehensive debug information for troubleshooting and InfluxDB logging
// Includes trigger reason, all condition states, timing windows, and entity states
message.debug = {
    triggered: shouldOpen,
    reason: reason || "no_trigger",
    conditions: {
        garageClosed: garageDoor?.state === "closed",
        teslaLocation,  // Still log it for debugging
        userHome,
        nightOrAsleep,
        inCooldown: Date.now() - ctx.lastOpen < COOLDOWN
    },
    timers: {
        sinceUnplug: (Date.now() - ctx.lastChargerDisconnect) / 1000,
        sinceMotion: (Date.now() - ctx.lastMotion) / 1000,
        sinceLastOpen: (Date.now() - ctx.lastOpen) / 1000
    },
    states: {
        userPresent,
        doorsOpen,
        teslaLocation: ctx.lastTeslaLocation,
        homeStatus: getEntity(ENTITIES.homeStatus)?.state,
        dayStatus: getEntity(ENTITIES.dayStatus)?.state,
        awakeStatus: getEntity(ENTITIES.awakeStatus)?.state
    }
};

