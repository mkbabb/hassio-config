import { mapRange } from "../../utils/utils";
import { DEFAULT_REMOTE_DATA, LightCommand } from "./constants";

function createOnServiceCall(target, inputData, currentState, attributes) {
    const { controller_id, device } = target;

    const MIN_BRIGHTNESS = 0;
    const MAX_BRIGHTNESS = 1;

    const MIN_BRIGHTNESS_LEVELS = 1;
    const MAX_BRIGHTNESS_LEVELS =
        // @ts-ignore
        parseFloat(attributes.brightness_levels) ?? MIN_BRIGHTNESS_LEVELS;

    const mappedInputBrightness = mapRange(
        parseFloat(inputData.brightness_pct) ?? 0,
        MIN_BRIGHTNESS,
        MAX_BRIGHTNESS,
        MIN_BRIGHTNESS_LEVELS,
        MAX_BRIGHTNESS_LEVELS
    );

    // if brightness is at the minimum level, we want to turn off the light
    if (mappedInputBrightness === MIN_BRIGHTNESS_LEVELS) {
        return createOffServiceCall(target, inputData, currentState, attributes);
    }

    const reverseMappedInputBrightness = mapRange(
        mappedInputBrightness,
        MIN_BRIGHTNESS_LEVELS,
        MAX_BRIGHTNESS_LEVELS,
        MIN_BRIGHTNESS,
        MAX_BRIGHTNESS
    );

    // Current brightness is NOT mapped by default; default is 1.0
    const currentBrightness = mapRange(
        // @ts-ignore
        currentState.brightness ?? 1,
        MIN_BRIGHTNESS,
        MAX_BRIGHTNESS,
        MIN_BRIGHTNESS_LEVELS,
        MAX_BRIGHTNESS_LEVELS
    );

    let serviceCalls = [];
    // if the current brightness is 0, then we need to add a call to turn on the light
    if (currentState.brightness === 0 || currentState.state === "off") {
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

    // how many levels of brightness we want to change
    const brightnessDelta = Math.round(mappedInputBrightness - currentBrightness);

    // if it's negative, we want to decrease the brightness
    const brightnessDirection =
        brightnessDelta < 0 ? LightCommand.BRIGHTNESS_DOWN : LightCommand.BRIGHTNESS_UP;

    currentState.state = "on";
    currentState.brightness = reverseMappedInputBrightness;

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

    return serviceCalls;
}

function createOffServiceCall(target, inputData, currentState, attributes) {
    const { controller_id, device } = target;

    currentState.state = "off";

    return [
        {
            service: "send_command",
            domain: "remote",
            target: {
                entity_id: controller_id
            },
            data: {
                num_repeats: 1,
                delay_secs: 0.4,
                hold_secs: 0.1,
                device,
                command: LightCommand.TURN_OFF
            }
        }
    ];
}

export function createServiceCall(
    service,
    target,
    inputData,
    currentState,
    attributes
) {
    switch (service) {
        case "turn_on":
            return createOnServiceCall(target, inputData, currentState, attributes);
        case "turn_off":
            return createOffServiceCall(target, inputData, currentState, attributes);
        default:
            return undefined;
    }
}
