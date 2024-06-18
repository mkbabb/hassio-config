import { mapRange, parseFloatIfString } from "../../utils/utils";

export const DEFAULT_REMOTE_DATA = {
    num_repeats: 1,
    delay_secs: 0.1,
    hold_secs: 0.05
} as const;

export enum OnOffCommand {
    TURN_ON = "turn_on",
    TURN_OFF = "turn_off",
    TOGGLE = "toggle"
}

// Make an enum for light commands
export enum LightCommand {
    TURN_ON = OnOffCommand.TURN_ON,
    TURN_OFF = OnOffCommand.TURN_OFF,
    TOGGLE = OnOffCommand.TOGGLE,
    INCREASE_BRIGHTNESS = "increase_brightness",
    DECREASE_BRIGHTNESS = "decrease_brightness",
    INCREASE_COLOR_TEMP = "increase_color_temp",
    DECREASE_COLOR_TEMP = "decrease_color_temp",
    RESET = "reset"
}

export const LightService = ["turn_on", "turn_off", "toggle", "reset"] as const;

export enum FanCommand {
    TURN_ON = OnOffCommand.TURN_ON,
    TURN_OFF = OnOffCommand.TURN_OFF,
    TOGGLE = OnOffCommand.TOGGLE,
    INCREASE_SPEED = "increase_speed",
    DECREASE_SPEED = "decrease_speed",
    OSCILLATE_ON = "oscillate_on",
    OSCILLATE_OFF = "oscillate_off",
    SET_PRESET_MODE = "set_preset_mode",
    SET_DIRECTION = "set_direction",
    RESET = "reset"
}

export const FanService = [
    "turn_on",
    "turn_off",
    "toggle",
    "oscillate",
    "set_preset_mode",
    "increase_speed",
    "decrease_speed",
    "set_direction",
    "reset"
] as const;

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

type AttributeStateKeys = keyof LightState | keyof FanState;

// Define DomainType, BaseServiceType, LightServiceType, and FanServiceType as const arrays
export const DomainType = ["light", "fan"] as const;

// Generic RemoteServiceCallInput
export type TRemoteServiceCallPayload<TService, TState, TAttributes, TInputData> = {
    domain: (typeof DomainType)[number];
    service: TService;
    target: Target;
    data: Partial<TInputData>;
    entity_state: Partial<TState>;
    entity_attributes: Partial<TAttributes>;
};

// Specialized RemoteServiceCallInput types
export type LightServiceCallPayload = TRemoteServiceCallPayload<
    (typeof LightService)[number],
    LightState,
    LightAttributes,
    LightInputData
>;
export type FanServiceCallPayload = TRemoteServiceCallPayload<
    (typeof FanService)[number],
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
    attribute: keyof LightState
) {
    let maxLevel;
    let currentValue;
    let mappedInputValue;

    if (attribute == "brightness") {
        maxLevel = parseFloatIfString(payload.entity_attributes.brightness_levels);

        mappedInputValue = mapInputBrightness(payload, maxLevel);

        currentValue = parseFloatIfString(payload.entity_state.brightness);
    } else if (attribute === "color_temp") {
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

function getFanPayloadValues(
    payload: FanServiceCallPayload,
    attribute: keyof FanState
) {
    let maxLevel;
    let currentValue;
    let mappedInputValue;

    if (attribute == "speed") {
        maxLevel = parseFloatIfString(payload.entity_attributes.speed_levels);
        mappedInputValue = mapRange(
            parseFloatIfString(payload.data.percentage),
            MIN_PERCENTAGE,
            MAX_PERCENTAGE,
            MIN_LEVEL,
            maxLevel
        );
        currentValue = parseFloatIfString(payload.entity_state.speed);
    }

    return { maxLevel, currentValue, mappedInputValue };
}

export function calcPayloadAttributeState(
    payload: ServiceCallPayload,
    attribute: string
) {
    const DEFAULT_PAYLOAD = {
        currentValue: undefined,
        reverseMappedInputValue: undefined,
        delta: undefined,
        percentage: undefined
    };

    const { maxLevel, currentValue, mappedInputValue } = (() => {
        if (isLightServiceCallPayload(payload)) {
            return getLightPayloadValues(payload, attribute as any);
        } else if (isFanServiceCallPayload(payload)) {
            return getFanPayloadValues(payload, attribute as any);
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

const NUM_REPEATS_FOR_RESET = 10;

function resetAttributeState(
    payload: ServiceCallPayload,
    attribute: AttributeStateKeys,
    command: string
) {
    const { controller_id, device } = payload.target;
    const { entity_state } = payload;

    entity_state[attribute] = 0.0;

    return {
        service: "send_command",
        domain: "remote",
        target: {
            entity_id: controller_id
        },
        data: {
            ...DEFAULT_REMOTE_DATA,
            num_repeats: NUM_REPEATS_FOR_RESET,
            device,
            command
        }
    };
}

export function createResetServiceCall(payload: ServiceCallPayload) {
    let serviceCalls = [];

    const { controller_id, device } = payload.target;
    const { entity_state } = payload;

    if (entity_state.state === "off") {
        entity_state.state = "on";

        serviceCalls.push({
            service: "send_command",
            domain: "remote",
            target: {
                entity_id: controller_id
            },
            data: {
                ...DEFAULT_REMOTE_DATA,
                device,
                command: "turn_on"
            }
        });
    }

    if (isLightServiceCallPayload(payload)) {
        const brightnessReset = resetAttributeState(
            payload,
            "brightness",
            LightCommand.DECREASE_BRIGHTNESS
        );
        serviceCalls.push(brightnessReset);

        const colorTempReset = resetAttributeState(
            payload,
            "color_temp",
            LightCommand.DECREASE_COLOR_TEMP
        );
        serviceCalls.push(colorTempReset);
    } else if (isFanServiceCallPayload(payload)) {
        const speedReset = resetAttributeState(
            payload,
            "speed",
            FanCommand.DECREASE_SPEED
        );
        serviceCalls.push(speedReset);

        const oscillationReset = resetAttributeState(
            payload,
            "oscillating",
            FanCommand.OSCILLATE_OFF
        );
        serviceCalls.push(oscillationReset);
    }

    return serviceCalls;
}
