import { getEntity, getEntities, getEntitiesByDomain, getEntitiesByPattern } from "../utils/entities";
import { getEntityDomain } from "../utils/utils";
import { groupActions, serviceToActionCall } from "../utils/service-calls";
import type { EntityState } from "./types";

// Type guards for light entities
function isLightEntity(entity: Hass.State): entity is Hass.LightState {
    return getEntityDomain(entity.entity_id) === "light";
}

function hasLightAttributes(_attributes: Partial<Hass.Attribute>): _attributes is Partial<Hass.Attributes.Light> {
    return true; // Since we check domain first, we can safely cast
}

// Safe attribute accessors for lights
function getLightBrightness(entity: Hass.State): number | undefined {
    if (isLightEntity(entity) && hasLightAttributes(entity.attributes)) {
        return entity.attributes.brightness;
    }
    return undefined;
}

function getLightColorTemp(entity: Hass.State): number | undefined {
    if (isLightEntity(entity) && hasLightAttributes(entity.attributes)) {
        return entity.attributes.color_temp;
    }
    return undefined;
}

function getLightSupportedFeatures(entity: Hass.State): number | undefined {
    if (isLightEntity(entity) && hasLightAttributes(entity.attributes)) {
        return entity.attributes.supported_features;
    }
    return undefined;
}

const PRESENCE_STATE_ENTITY_ID = "input_select.home_status";

// Default states for sunrise/sunset simulation
const DEFAULT_SUNRISE_STATE: EntityState = {
    state: "on",
    data: {
        brightness: 255,
        kelvin: 3000  // Warm white 3000K max
    }
};

const DEFAULT_SUNSET_STATE: EntityState = {
    state: "off"
};

// Color temperature range in Kelvin
const WARM_KELVIN = 2200;   // Warm candlelight
const COOL_KELVIN = 3000;   // Max allowed cool white

// Brightness hysteresis threshold (turn off at this value or below)
const BRIGHTNESS_OFF_THRESHOLD = 3;

// Convert Kelvin to mireds for Home Assistant
function kelvinToMireds(kelvin: number): number {
    return Math.round(1000000 / kelvin);
}

interface SimulateSunOptions {
    t: number;                    // 0-1 interpolation value
    preamble_minutes?: number;    // For phase calculation
    postamble_minutes?: number;   // For phase calculation
    phase?: "sunrise" | "sunset"; // Which simulation to run
    entities?: string[];          // Override default entity selection
}

// Resolve entity patterns (supports "regex:..." prefix and literal entity IDs)
function resolveEntityPatterns(patterns: string[]): Hass.State[] {
    const results = new Map<string, Hass.State>();

    for (const pattern of patterns) {
        if (pattern.startsWith("regex:")) {
            const regexStr = pattern.slice(6);
            try {
                const matches = getEntitiesByPattern(new RegExp(regexStr));
                for (const entity of matches) {
                    results.set(entity.entity_id, entity);
                }
            } catch {
                // Invalid regex — skip
            }
        } else {
            const entity = getEntity(pattern);
            if (entity) {
                results.set(entity.entity_id, entity);
            }
        }
    }

    return Array.from(results.values());
}

// Get master bedroom lights for sunrise (default fallback)
function getMasterBedroomLights(): Hass.State[] {
    return getEntities({
        domain: "light",
        area: "master_bedroom"
    });
}

// Get all currently ON lights for sunset
function getCurrentlyOnLights(): Hass.State[] {
    return getEntitiesByDomain("light").filter(entity => entity.state === "on");
}

// Check if we're home
function isHome(): boolean {
    const presenceEntity = getEntity(PRESENCE_STATE_ENTITY_ID);
    return presenceEntity?.state === "home";
}

// Check if light supports brightness
function supportsBrightness(entity: Hass.State): boolean {
    const features = getLightSupportedFeatures(entity);
    return !!(features && (features & 1) === 1); // SUPPORT_BRIGHTNESS = 1
}

// Check if light supports color temperature
function supportsColorTemp(entity: Hass.State): boolean {
    const features = getLightSupportedFeatures(entity);
    return !!(features && (features & 2) === 2); // SUPPORT_COLOR_TEMP = 2
}

// Linear interpolation between two values
function lerpValue(t: number, start: number, end: number): number {
    return start + (end - start) * t;
}

// Binary light state tracking — prevents flicker from stateless probability
const BINARY_STATES_KEY = "sunriseBinaryStates";

function getBinaryStates(): Record<string, boolean> {
    // @ts-ignore — ephemeral, memory store
    return flow.get(BINARY_STATES_KEY, "memory") || {};
}

function setBinaryStates(states: Record<string, boolean>): void {
    // @ts-ignore
    flow.set(BINARY_STATES_KEY, states, "memory");
}

// Deterministic binary light control with state tracking
// Once turned on, stays on. Once turned off (sunset), stays off.
function shouldBinaryLightBeOn(entityId: string, t: number, phase: "sunrise" | "sunset"): boolean {
    const binaryStates = getBinaryStates();
    const currentlyOn = binaryStates[entityId] ?? false;

    if (phase === "sunrise") {
        if (currentlyOn) return true; // Already on, keep on

        // Probability threshold: lights turn on progressively after 75%
        // Use a deterministic hash based on entity ID to stagger timing
        const hash = entityId.split("").reduce((a, c) => a + c.charCodeAt(0), 0);
        const threshold = 0.75 + (hash % 25) / 100; // 0.75 to 1.0

        if (t >= threshold) {
            binaryStates[entityId] = true;
            setBinaryStates(binaryStates);
            return true;
        }
        return false;
    } else {
        // Sunset: turn off progressively after 75%
        if (!currentlyOn) return false; // Already off, keep off

        const hash = entityId.split("").reduce((a, c) => a + c.charCodeAt(0), 0);
        const threshold = 0.75 + (hash % 25) / 100;

        if (t >= threshold) {
            binaryStates[entityId] = false;
            setBinaryStates(binaryStates);
            return false; // Turn off
        }
        return true; // Keep on
    }
}

// Create service call for light with interpolated values
function createLightServiceCall(
    entity: Hass.State,
    t: number,
    phase: "sunrise" | "sunset",
    targetState: EntityState
): Partial<Hass.Service> | null {
    const domain = getEntityDomain(entity.entity_id);

    if (domain !== "light") return null;

    const serviceData: Record<string, any> = {
        entity_id: entity.entity_id
    };

    if (phase === "sunrise") {
        // Sunrise: fade from off to target brightness/color
        if (supportsBrightness(entity)) {
            const targetBrightness = targetState.data?.brightness || 255;
            serviceData.brightness = Math.round(lerpValue(t, 1, targetBrightness));
        }

        if (supportsColorTemp(entity)) {
            // Interpolate in mireds directly to avoid Kelvin rounding drift
            const targetKelvin = targetState.data?.kelvin || COOL_KELVIN;
            const warmMireds = kelvinToMireds(WARM_KELVIN);
            const targetMireds = kelvinToMireds(targetKelvin);
            serviceData.color_temp = Math.round(lerpValue(t, warmMireds, targetMireds));
        }

        // For non-brightness lights, use deterministic state tracking
        if (!supportsBrightness(entity)) {
            if (shouldBinaryLightBeOn(entity.entity_id, t, "sunrise")) {
                return {
                    domain: "light",
                    service: "turn_on",
                    data: serviceData
                };
            }
            return null; // Don't turn on yet
        }

        return {
            domain: "light",
            service: "turn_on",
            data: serviceData
        };
    } else {
        // Sunset: fade from current to off
        if (supportsBrightness(entity)) {
            const currentBrightness = getLightBrightness(entity) || 255;
            const newBrightness = Math.round(lerpValue(t, currentBrightness, 1));

            if (newBrightness <= BRIGHTNESS_OFF_THRESHOLD) {
                // Turn off when brightness gets too low (hysteresis at 3 to prevent edge flicker)
                return {
                    domain: "light",
                    service: "turn_off",
                    data: { entity_id: entity.entity_id }
                };
            } else {
                serviceData.brightness = newBrightness;
            }
        }

        if (supportsColorTemp(entity)) {
            const currentMireds = getLightColorTemp(entity) || kelvinToMireds(COOL_KELVIN);
            const warmMireds = kelvinToMireds(WARM_KELVIN);
            // Interpolate directly in mireds
            serviceData.color_temp = Math.round(lerpValue(t, currentMireds, warmMireds));
        }

        // For non-brightness lights, use deterministic state tracking
        if (!supportsBrightness(entity)) {
            if (!shouldBinaryLightBeOn(entity.entity_id, t, "sunset")) {
                return {
                    domain: "light",
                    service: "turn_off",
                    data: { entity_id: entity.entity_id }
                };
            }
            return null; // Keep on for now
        }

        return {
            domain: "light",
            service: "turn_on",
            data: serviceData
        };
    }
}

// Main simulate-sun function
// @ts-ignore
const message = msg;

// Check if we have scheduleEvents from schedule.ts
let options: SimulateSunOptions;
if (message.scheduleEvents && Array.isArray(message.scheduleEvents)) {
    // Find relevant schedule events ONLY from day_status schedule
    const relevantEvent = message.scheduleEvents.find((event: any) =>
        event.schedule === "day_status" && (
            (event.type === "ramp_up" && event.phase === "sunrise") ||
            (event.type === "ramp_down" && event.phase === "sunset")
        )
    );

    if (relevantEvent) {
        // Look up interpolation.entities from the schedule registry
        // @ts-ignore
        const registry = global.get("scheduleRegistry");
        const dayStatusSchedule = registry?.schedules?.["day_status"];
        const interpolationEntities = dayStatusSchedule?.interpolation?.entities;

        options = {
            t: relevantEvent.t,
            phase: relevantEvent.phase as "sunrise" | "sunset",
            entities: message.options?.entities || interpolationEntities
        };
    } else {
        // Fallback to options if no relevant event from day_status
        options = message.options || {};
    }
} else {
    // Use provided options
    options = message.options || {};
}

// Extract parameters
const t = options.t || 0;
const phase = options.phase || "sunrise";

// Only proceed if we're home
if (!isHome()) {
    // @ts-ignore
    msg.payload = null;
    // @ts-ignore
    msg.debug = { reason: "not_home", presence_state: getEntity(PRESENCE_STATE_ENTITY_ID)?.state };
} else {
    // Get target entities based on phase and options
    let targetEntities: Hass.State[];
    if (options.entities && options.entities.length > 0) {
        // Use specified entities (supports regex: prefix)
        targetEntities = resolveEntityPatterns(options.entities);
    } else if (phase === "sunrise") {
        // Default: master bedroom lights
        targetEntities = getMasterBedroomLights();
    } else {
        // Default: currently ON lights
        targetEntities = getCurrentlyOnLights();
    }

    // Create service calls for each entity
    const serviceActions: Partial<Hass.Service>[] = [];
    const entityDebugInfo: any[] = [];

    targetEntities.forEach(entity => {
        const targetState = phase === "sunrise" ? DEFAULT_SUNRISE_STATE : DEFAULT_SUNSET_STATE;
        const action = createLightServiceCall(entity, t, phase, targetState);

        if (action) {
            serviceActions.push(action);
        }

        const brightness = getLightBrightness(entity);
        const colorTemp = getLightColorTemp(entity);

        entityDebugInfo.push({
            entity_id: entity.entity_id,
            current_state: entity.state,
            brightness,
            color_temp: colorTemp,
            color_temp_kelvin: colorTemp ? Math.round(1000000 / colorTemp) : null,
            supports_brightness: supportsBrightness(entity),
            supports_color_temp: supportsColorTemp(entity),
            action_created: !!action
        });
    });

    // Group and output actions
    // @ts-ignore
    msg.payload = groupActions(serviceActions.map(serviceToActionCall));

    // Debug information
    // @ts-ignore
    msg.debug = {
        phase,
        t,
        entities_found: targetEntities.length,
        actions_generated: serviceActions.length,
        presence_state: getEntity(PRESENCE_STATE_ENTITY_ID)?.state,
        entity_selection: options.entities ? "configured" : "default",
        entity_details: entityDebugInfo
    };
}
