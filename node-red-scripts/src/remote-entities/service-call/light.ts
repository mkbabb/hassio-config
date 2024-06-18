import {
    DEFAULT_REMOTE_DATA,
    LightCommand,
    LightServiceCallPayload,
    calcPayloadAttributeState,
    createResetServiceCall
} from "./utils";

/* Example template payload:
{
    "service": "turn_on",
    "target": {
        "controller_id": "{{ controller_id }}",
        "device": "{{ device }}",
        "entity_id": "{{ entity_id }}",
        "entity_attributes_id": "{{ entity_attributes_id }}"
    },
    "data": {
        "state": "{{ state | default('') }}",
        "color_mode": "{{ color_mode | default('') }}",
        "white_value": "{{ white_value | default('') }}",
        "brightness_pct": "{{ brightness_pct | default('') }}",
        "color_temp": "{{ color_temp | default('') }}",
        "hs_color": "{{ hs_color | default('') }}",
        "rgb_color": "{{ rgb_color | default('') }}",
        "effect": "{{ effect | default('') }}",
        "transition": "{{ transition | default('') }}"
    },
    "entity_state": {
        "state": "on",
        "brightness": 0.5
    },
    "entity_attributes": {
        "brightness_levels": 5,
        "supports_rgb": false,
        "supports_color_temp": false
    }
}
*/

function createOnServiceCall(payload: LightServiceCallPayload) {
    let serviceCalls = [];

    const { controller_id, device } = payload.target;
    const { entity_state, data } = payload;

    const {
        currentValue: currentBrightness,
        reverseMappedInputValue: reverseMappedInputBrightness,
        delta: brightnessDelta,
        percentage: brightnessPercentage
    } = calcPayloadAttributeState(payload, "brightness");

    // if the current brightness is 0 then turn on the light
    if (currentBrightness === 0 || entity_state.state === "off") {
        serviceCalls.push({
            service: "send_command",
            domain: "remote",
            target: {
                entity_id: controller_id
            },
            data: {
                ...DEFAULT_REMOTE_DATA,
                device,
                command: LightCommand.TURN_ON
            }
        });
    }
    // if the percentage is 0, then turn off the light
    else if (brightnessPercentage === 0) {
        return createOffServiceCall(payload);
    }

    if (
        reverseMappedInputBrightness != undefined &&
        !Number.isNaN(reverseMappedInputBrightness)
    ) {
        const brightnessDirection =
            brightnessDelta > 0
                ? LightCommand.INCREASE_BRIGHTNESS
                : LightCommand.DECREASE_BRIGHTNESS;

        entity_state.brightness = reverseMappedInputBrightness;

        serviceCalls.push({
            service: "send_command",
            domain: "remote",
            target: {
                entity_id: controller_id
            },
            data: {
                ...DEFAULT_REMOTE_DATA,
                num_repeats: Math.abs(brightnessDelta),
                device,
                command: brightnessDirection
            }
        });
    }

    const {
        currentValue: currentColorTemp,
        reverseMappedInputValue: reverseMappedInputColorTemp,
        delta: colorTempDelta
    } = calcPayloadAttributeState(payload, "color_temp");

    if (
        reverseMappedInputColorTemp != undefined &&
        !Number.isNaN(reverseMappedInputColorTemp)
    ) {
        const colorTempDirection =
            colorTempDelta > 0
                ? LightCommand.DECREASE_COLOR_TEMP
                : LightCommand.INCREASE_COLOR_TEMP;

        entity_state.color_temp = reverseMappedInputColorTemp;

        serviceCalls.push({
            service: "send_command",
            domain: "remote",
            target: {
                entity_id: controller_id
            },
            data: {
                ...DEFAULT_REMOTE_DATA,
                num_repeats: Math.abs(colorTempDelta),
                device,
                command: colorTempDirection
            }
        });
    }

    entity_state.state = "on";

    return serviceCalls;
}

function createOffServiceCall(payload: LightServiceCallPayload) {
    const { controller_id, device } = payload.target;

    const { entity_state } = payload;

    entity_state.state = "off";

    return [
        {
            service: "send_command",
            domain: "remote",
            target: {
                entity_id: controller_id
            },
            data: {
                ...DEFAULT_REMOTE_DATA,
                device,
                command: LightCommand.TURN_OFF
            }
        }
    ];
}

function createToggleServiceCall(payload: LightServiceCallPayload) {
    const { entity_state } = payload;
    const newState = entity_state.state === "off" ? "on" : "off";

    const serviceCall =
        entity_state.state === "off"
            ? createOnServiceCall(payload)
            : createOffServiceCall(payload);

    entity_state.state = newState;

    return serviceCall;
}

export function createServiceCall(payload: LightServiceCallPayload) {
    switch (payload.service) {
        case "turn_on":
            return createOnServiceCall(payload);
        case "turn_off":
            return createOffServiceCall(payload);
        case "toggle":
            return createToggleServiceCall(payload);
        case "reset":
            createResetServiceCall(payload);
        default:
            return undefined;
    }
}
