import {
    DEFAULT_REMOTE_DATA,
    FanCommand,
    FanServiceCallPayload,
    calcPayloadAttributeState
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
        "percentage": "{{ percentage | default('') }}",
        "preset_mode": "{{ preset_mode | default('') }}",
        "direction": "{{ direction | default('') }}",
        "oscillating": "{{ oscillating | default('') }}",
    },
    "entity_state": {
        "state": "on",
        "speed": 0.5
    },
    "entity_attributes": {
        "speed_levels": 5
    }
}
*/
function createOnServiceCall(payload: FanServiceCallPayload) {
    let serviceCalls = [];

    const { controller_id, device } = payload.target;
    const { entity_state } = payload;

    const {
        currentValue: currentSpeed,
        reverseMappedInputValue: reverseMappedInputSpeed,
        delta: speedDelta,
        percentage: speedPercentage
    } = calcPayloadAttributeState(payload, "speed");

    // if the current speed is 0 then turn on the fan
    if (currentSpeed === 0 || entity_state.state === "off") {
        serviceCalls.push({
            service: "send_command",
            domain: "remote",
            target: {
                entity_id: controller_id
            },
            data: {
                ...DEFAULT_REMOTE_DATA,
                device,
                command: FanCommand.TURN_ON
            }
        });
    }
    // if the percentage is 0, then turn off the fan
    else if (speedPercentage === 0) {
        return createOffServiceCall(payload);
    }

    if (reverseMappedInputSpeed != undefined) {
        const speedDirection =
            speedDelta > 0 ? FanCommand.INCREASE_SPEED : FanCommand.DECREASE_SPEED;

        entity_state.speed = reverseMappedInputSpeed;

        serviceCalls.push({
            service: "send_command",
            domain: "remote",
            target: {
                entity_id: controller_id
            },
            data: {
                ...DEFAULT_REMOTE_DATA,
                num_repeats: Math.abs(speedDelta),
                device,
                command: speedDirection
            }
        });
    }

    entity_state.state = "on";

    return serviceCalls;
}

function createOffServiceCall(payload: FanServiceCallPayload) {
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
                command: FanCommand.TURN_OFF
            }
        }
    ];
}

function createToggleServiceCall(payload: FanServiceCallPayload) {
    const { entity_state } = payload;

    const newState = entity_state.state === "off" ? "on" : "off";

    const serviceCall =
        entity_state.state === "off"
            ? createOnServiceCall(payload)
            : createOffServiceCall(payload);

    entity_state.state = newState;

    return serviceCall;
}

function setPresetModeServiceCall(payload: FanServiceCallPayload) {
    const { controller_id, device } = payload.target;
    const { data } = payload;

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
                command: data.preset_mode
            }
        }
    ];
}

function setDirectionServiceCall(payload: FanServiceCallPayload) {
    const { controller_id, device } = payload.target;
    const { data } = payload;

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
                command: data.direction
            }
        }
    ];
}

function oscillateServiceCall(payload: FanServiceCallPayload) {
    const { controller_id, device } = payload.target;
    const { data, entity_state } = payload;

    entity_state.oscillating = data.oscillating;

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
                command: data.oscillating
                    ? FanCommand.OSCILLATE_ON
                    : FanCommand.OSCILLATE_OFF
            }
        }
    ];
}

function increaseSpeedServiceCall(payload: FanServiceCallPayload) {
    const { controller_id, device } = payload.target;
    const { data } = payload;

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
                command: FanCommand.INCREASE_SPEED,
                num_repeats: data.percentage_step
            }
        }
    ];
}

function decreaseSpeedServiceCall(payload: FanServiceCallPayload) {
    const { controller_id, device } = payload.target;
    const { data } = payload;

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
                command: FanCommand.DECREASE_SPEED,
                num_repeats: data.percentage_step
            }
        }
    ];
}

export function createServiceCall(payload: FanServiceCallPayload) {
    switch (payload.service) {
        case "turn_on":
            return createOnServiceCall(payload);
        case "turn_off":
            return createOffServiceCall(payload);
        case "toggle":
            return createToggleServiceCall(payload);
        case "set_preset_mode":
            return setPresetModeServiceCall(payload);
        case "oscillate":
            return oscillateServiceCall(payload);
        case "increase_speed":
            return increaseSpeedServiceCall(payload);
        case "decrease_speed":
            return decreaseSpeedServiceCall(payload);
        default:
            return undefined;
    }
}
