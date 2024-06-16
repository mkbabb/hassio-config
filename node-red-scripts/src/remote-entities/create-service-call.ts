/* Example template payload:
msg.payload = {
           "service": "turn_on",
           "target": {
            "controller_id": "{{ controller_id }}",
            "device": "{{ device }}",
            "entity_id": "{{ entity_id }}"
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
        }
        "entity_state": {
            "state": "on",
            "brightness": 0.5,
        },
        "entity_attributes": {
            "brightness_levels": 5, 
            "supports_rgb": false, 
            "supports_color_temp": false,
        }
}
*/
import { mapRange } from "../utils/utils";

function createOnServiceCall(target, inputData, currentState) {
    const { controller_id, device } = target;

    const MIN_BRIGHTNESS = 0;
    const MAX_BRIGHTNESS = 1;

    const MIN_BRIGHTNESS_LEVELS = 1;
    const MAX_BRIGHTNESS_LEVELS =
        // @ts-ignore
        parseFloat(msg.payload.entity_attributes.brightness_levels) ??
        MIN_BRIGHTNESS_LEVELS;

    const mappedInputBrightness = mapRange(
        parseFloat(inputData.brightness_pct) ?? 0,
        MIN_BRIGHTNESS,
        MAX_BRIGHTNESS,
        MIN_BRIGHTNESS_LEVELS,
        MAX_BRIGHTNESS_LEVELS
    );

    // if brightness is at the minimum level, we want to turn off the light
    if (mappedInputBrightness === MIN_BRIGHTNESS_LEVELS) {
        return createOffServiceCall(target, inputData, currentState);
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

    let calls = [];

    // if the current brightness is 0, then we need to add a call to turn on the light
    if (currentState.brightness === 0 || currentState.state === "off") {
        calls.push({
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
                command: "turn on"
            }
        });
    }

    // how many levels of brightness we want to change
    const brightnessDelta = Math.round(mappedInputBrightness - currentBrightness);

    // if it's negative, we want to decrease the brightness
    const brightnessDirection =
        brightnessDelta < 0 ? "brightness down" : "brightness up";

    currentState.state = "on";
    currentState.brightness = reverseMappedInputBrightness;

    calls.push({
        service: "send_command",
        domain: "remote",
        target: {
            entity_id: controller_id
        },
        data: {
            num_repeats: Math.abs(brightnessDelta),
            delay_secs: 0.4,
            hold_secs: 0.1,
            device,
            command: brightnessDirection
        }
    });

    return calls;
}

function createOffServiceCall(target, inputData, currentState) {
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
                command: "turn off"
            }
        }
    ];
}

//@ts-ignore
msg.payload.entity_attributes = JSON.parse(msg.payload.entity_attributes);
//@ts-ignore
msg.payload.entity_state = JSON.parse(msg.payload.entity_state);

//@ts-ignore
const service = msg.payload.service;

//@ts-ignore
const currentState = msg.payload.entity_state;
//@ts-ignore
const inputData = msg.payload.data;
//@ts-ignore
const target = msg.payload.target;

const serviceCalls = (() => {
    switch (service) {
        case "turn_on":
            return createOnServiceCall(target, inputData, currentState);
        case "turn_off":
            return createOffServiceCall(target, inputData, currentState);
        default:
            return undefined;
    }
})();

// @ts-ignore
msg.payload = serviceCalls;
// @ts-ignore
msg.entity_state = JSON.stringify(currentState);
// @ts-ignore
msg.entity_state_id = target.entity_state_id;
