import { mapRange, parseFloatIfString } from "../../utils/utils";

export const DEFAULT_REMOTE_DATA = {
    num_repeats: 1,
    delay_secs: 0.1,
    hold_secs: 0.05
} as const;

// Make an enum for light commands
export enum LightCommand {
    TURN_ON = "turn_on",
    TURN_OFF = "turn_off",
    BRIGHTNESS_UP = "increase_brightness",
    BRIGHTNESS_DOWN = "decrease_brightness",
    TEMPERATURE_UP = "increase_color_temp",
    TEMPERATURE_DOWN = "decrease_color_temp"
}

export enum FanCommand {
    TURN_ON = "turn_on",
    TURN_OFF = "turn_off",
    INCREASE_SPEED = "increase_speed",
    DECREASE_SPEED = "decrease_speed",
    OSCILLATE_ON = "oscillate_on",
    OSCILLATE_OFF = "oscillate_off",
    SET_PRESET_MODE = "set_preset_mode"
}

// Base class
export type Target = {
    controller_id: string;
    device: string;
    entity_id?: string;
    entity_attributes_id?: string;
};

export type BaseInputData = {
    state?: string;
};

export type BaseState = {
    state: string;
};

export type BaseAttributes = {};

export type FanInputData = BaseInputData & {
    percentage?: string;
    percentage_step?: string;
    preset_mode?: string;
    direction?: string;
    oscillating?: boolean;
};

export type FanState = BaseState & {
    speed?: number;
    preset_mode?: string;
    direction?: string;
    oscillating?: boolean;
};

export type FanAttributes = BaseAttributes & {
    speed_levels?: number;
};

export type LightInputData = BaseInputData & {
    brightness?: string;
    brightness_pct?: string;
    brightness_step?: string;
    color_temp?: string;
};

export type LightState = BaseState & {
    brightness?: number;
    color_temp?: number;
};

export type LightAttributes = BaseAttributes & {
    brightness_levels?: number;
    color_temp_levels?: number;
};

// Define DomainType, BaseServiceType, LightServiceType, and FanServiceType as const arrays
export const DomainType = ["light", "fan"] as const;
export const BaseServiceType = ["turn_on", "turn_off", "toggle"] as const;

export const LightServiceType = [
    ...BaseServiceType,
    "increase_brightness",
    "decrease_brightness",
    "increase_temperature",
    "decrease_temperature"
] as const;

export const FanServiceType = [
    ...BaseServiceType,
    "increase_speed",
    "decrease_speed",
    "oscillate",
    "set_preset_mode"
] as const;

// Types for DomainType, BaseServiceType, LightServiceType, and FanServiceType
export type DomainType = (typeof DomainType)[number];
export type BaseServiceType = (typeof BaseServiceType)[number];
export type LightServiceType = (typeof LightServiceType)[number];
export type FanServiceType = (typeof FanServiceType)[number];

// Generic RemoteServiceCallInput
export type TRemoteServiceCallPayload<TService, TState, TAttributes, TInputData> = {
    domain: DomainType;
    service: TService;
    target: Target;
    data: Partial<TInputData>;
    entity_state: Partial<TState>;
    entity_attributes: Partial<TAttributes>;
};

// Specialized RemoteServiceCallInput types
export type LightServiceCallPayload = TRemoteServiceCallPayload<
    LightServiceType,
    LightState,
    LightAttributes,
    LightInputData
>;
export type FanServiceCallPayload = TRemoteServiceCallPayload<
    FanServiceType,
    FanState,
    FanAttributes,
    FanInputData
>;

export type ServiceCallPayload = LightServiceCallPayload | FanServiceCallPayload;

export const MIN_LEVEL = 1;

export const MIN_PERCENTAGE = 0;
export const MAX_PERCENTAGE = 100;

export const MIN_COLOR_TEMP = 154;
export const MAX_COLOR_TEMP = 500;

export const MIN_UNIT = 0;
export const MAX_UNIT = 1;

export const MIN_BINARY = 0;
export const MAX_BINARY = 255;

export const MIN_STEP = -1;
export const MAX_STEP = 1;

// Handle the cases when brightness, brightness_pct, or brightness_step are provided;
// Thereupon map them to a range of 0 to 1, which is the range of brightness
function mapInputBrightness(payload: LightServiceCallPayload, maxLevel: number) {
    const { data } = payload;

    const [brightnessString, minBrightness, maxBrightness] = (() => {
        if (data.brightness) {
            return [data.brightness, MIN_BINARY, MAX_BINARY];
        } else if (data.brightness_pct) {
            return [data.brightness_pct, MIN_PERCENTAGE, MAX_PERCENTAGE];
        } else if (data.brightness_step) {
            return [data.brightness_step, MIN_STEP, MAX_STEP];
        } else {
            return [undefined, MIN_UNIT, MAX_UNIT];
        }
    })();

    const brightness = parseFloatIfString(brightnessString);

    return mapRange(brightness, minBrightness, maxBrightness, MIN_LEVEL, maxLevel);
}

function isLightServiceCallPayload(
    payload: ServiceCallPayload
): payload is LightServiceCallPayload {
    return payload.domain === "light";
}

function isFanServiceCallPayload(
    payload: ServiceCallPayload
): payload is FanServiceCallPayload {
    return payload.domain === "fan";
}

function getLightPayloadValues(
    payload: LightServiceCallPayload,
    commandType: "brightness" | "color_temp"
) {
    let maxLevel;
    let currentValue;
    let mappedInputValue;

    if (commandType == "brightness") {
        maxLevel = parseFloatIfString(payload.entity_attributes.brightness_levels);

        mappedInputValue = mapInputBrightness(payload, maxLevel);

        currentValue = parseFloatIfString(payload.entity_state.brightness);
    } else if (commandType === "color_temp") {
        maxLevel = parseFloatIfString(payload.entity_attributes.color_temp_levels);

        mappedInputValue = parseFloatIfString(payload.data.color_temp);
        // color temp in kelvin
        mappedInputValue = mapRange(
            mappedInputValue,
            MIN_COLOR_TEMP,
            MAX_COLOR_TEMP,
            MIN_LEVEL,
            maxLevel
        );

        currentValue = parseFloatIfString(payload.entity_state.color_temp);
    }

    return { maxLevel, currentValue, mappedInputValue };
}

function getFanPayloadValues(payload: FanServiceCallPayload, commandType: "speed") {
    let maxLevel;
    let currentValue;
    let mappedInputValue;

    if (commandType == "speed") {
        maxLevel = parseFloatIfString(payload.entity_attributes.speed_levels);
        mappedInputValue = mapRange(
            parseFloatIfString(payload.data.percentage),
            MIN_PERCENTAGE,
            MAX_PERCENTAGE,
            MIN_LEVEL,
            maxLevel
        );
        // TODO: check if this mapping is necessary
        currentValue = parseFloatIfString(payload.entity_state.speed);
    }

    return { maxLevel, currentValue, mappedInputValue };
}

export function calcPayloadAttributeState(
    payload: ServiceCallPayload,
    commandType: "brightness" | "color_temp" | "speed"
) {
    const DEFAULT_PAYLOAD = {
        currentValue: undefined,
        reverseMappedInputValue: undefined,
        delta: undefined,
        percentage: undefined
    };

    const { maxLevel, currentValue, mappedInputValue } = (() => {
        if (isLightServiceCallPayload(payload)) {
            return getLightPayloadValues(payload, commandType as any);
        } else if (isFanServiceCallPayload(payload)) {
            return getFanPayloadValues(payload, commandType as any);
        }
    })();

    if (mappedInputValue == undefined) {
        return DEFAULT_PAYLOAD;
    }

    // normalize
    const currentMappedValue = mapRange(
        currentValue,
        MIN_UNIT,
        MAX_UNIT,
        MIN_LEVEL,
        maxLevel
    );

    // reverse normalized
    const reverseMappedInputValue = mapRange(
        mappedInputValue,
        MIN_LEVEL,
        maxLevel,
        MIN_UNIT,
        MAX_UNIT
    );

    const delta = Math.round(mappedInputValue - currentMappedValue);
    const percentage = mappedInputValue / maxLevel;

    return {
        currentValue,
        reverseMappedInputValue,
        delta,
        percentage
    };
}
