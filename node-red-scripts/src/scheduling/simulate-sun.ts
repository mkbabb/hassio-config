import { getEntity, getEntities, getEntitiesByDomain } from "../utils/ha-entities";
import { groupActions, serviceToActionCall, getEntityDomain } from "../utils/utils";
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

// Get master bedroom lights for sunrise
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

// Exponential interpolation for probabilistic sampling (75% to 100%)
function expLerp(t: number): number {
    // Map t from [0.75, 1] to [0, 1] for exponential curve
    const normalizedT = Math.max(0, (t - 0.75) / 0.25);
    // Exponential curve: x^3 for smooth acceleration
    return Math.pow(normalizedT, 3);
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
            const targetKelvin = targetState.data?.kelvin || COOL_KELVIN;
            // Start warm and transition to target color temp
            const interpolatedKelvin = Math.round(lerpValue(t, WARM_KELVIN, targetKelvin));
            serviceData.color_temp = kelvinToMireds(interpolatedKelvin);
        }
        
        // For non-brightness lights, use probabilistic sampling after 75%
        if (!supportsBrightness(entity) && t >= 0.75) {
            const probability = expLerp(t);
            if (Math.random() < probability) {
                serviceData.state = "on";
            } else {
                return null; // Don't turn on yet
            }
        } else if (!supportsBrightness(entity)) {
            return null; // Don't control non-brightness lights before 75%
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
            
            if (newBrightness <= 1) {
                // Turn off when brightness gets too low
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
            const currentKelvin = Math.round(1000000 / currentMireds);
            // Fade to warm during sunset
            const interpolatedKelvin = Math.round(lerpValue(t, currentKelvin, WARM_KELVIN));
            serviceData.color_temp = kelvinToMireds(interpolatedKelvin);
        }
        
        // For non-brightness lights, use probabilistic sampling after 75%
        if (!supportsBrightness(entity) && t >= 0.75) {
            const probability = expLerp(t);
            if (Math.random() < probability) {
                return {
                    domain: "light",
                    service: "turn_off",
                    data: { entity_id: entity.entity_id }
                };
            } else {
                return null; // Don't turn off yet
            }
        } else if (!supportsBrightness(entity)) {
            return null; // Don't control non-brightness lights before 75%
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
        options = {
            t: relevantEvent.t,
            phase: relevantEvent.phase as "sunrise" | "sunset",
            entities: message.options?.entities
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
if (options.entities) {
    // Use specified entities
    targetEntities = options.entities.map(getEntity).filter(Boolean) as Hass.State[];
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
    entity_details: entityDebugInfo
};
}
