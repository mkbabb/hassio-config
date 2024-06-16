// import { mapRange } from "../../utils/utils";
// import { DEFAULT_REMOTE_DATA, FanCommand } from "./constants";

// function createOnServiceCall(target, inputData, currentState, attributes) {
//     const { controller_id, device } = target;

//     const MIN_SPEED = 0;
//     const MAX_SPEED = 3;

//     // const MIN_BRIGHTNESS_LEVELS = 1;
//     // const MAX_BRIGHTNESS_LEVELS =
//     //     // @ts-ignore
//     //     parseFloat(msg.payload.entity_attributes.brightness_levels) ??
//     //     MIN_BRIGHTNESS_LEVELS;

//     const MIN_SPEED_LEVELS = 1;
//     const MAX_SPEED_LEVELS = parseFloat(attributes.speed_levels) ?? MIN_SPEED_LEVELS;

//     const mappedInputSpeed = mapRange(
//         parseFloat(inputData.speed) ?? 0,
//         MIN_SPEED,
//         MAX_SPEED,
//         MIN_SPEED_LEVELS,
//         MAX_SPEED_LEVELS
//     );

//     // if brightness is at the minimum level, we want to turn off the light
//     if (mappedInputBrightness === MIN_BRIGHTNESS_LEVELS) {
//         return createOffServiceCall(target, inputData, currentState);
//     }

//     const reverseMappedInputBrightness = mapRange(
//         mappedInputBrightness,
//         MIN_BRIGHTNESS_LEVELS,
//         MAX_BRIGHTNESS_LEVELS,
//         MIN_BRIGHTNESS,
//         MAX_BRIGHTNESS
//     );

//     // Current brightness is NOT mapped by default; default is 1.0
//     const currentBrightness = mapRange(
//         // @ts-ignore
//         currentState.brightness ?? 1,
//         MIN_BRIGHTNESS,
//         MAX_BRIGHTNESS,
//         MIN_BRIGHTNESS_LEVELS,
//         MAX_BRIGHTNESS_LEVELS
//     );

//     let calls = [];

//     // if the current brightness is 0, then we need to add a call to turn on the light
//     if (currentState.brightness === 0 || currentState.state === "off") {
//         calls.push({
//             service: "send_command",
//             domain: "remote",
//             target: {
//                 entity_id: controller_id
//             },
//             data: {
//                 ...DEFAULT_REMOTE_DATA,
//                 device,
//                 command: "turn on"
//             }
//         });
//     }

//     // how many levels of brightness we want to change
//     const brightnessDelta = Math.round(mappedInputBrightness - currentBrightness);

//     // if it's negative, we want to decrease the brightness
//     const brightnessDirection =
//         brightnessDelta < 0 ? "brightness down" : "brightness up";

//     currentState.state = "on";
//     currentState.brightness = reverseMappedInputBrightness;

//     calls.push({
//         service: "send_command",
//         domain: "remote",
//         target: {
//             entity_id: controller_id
//         },
//         data: {
//             ...DEFAULT_REMOTE_DATA,
//             num_repeats: Math.abs(brightnessDelta),
//             device,
//             command: brightnessDirection
//         }
//     });

//     return calls;
// }

// function createOffServiceCall(target, inputData, currentState) {
//     const { controller_id, device } = target;

//     currentState.state = "off";

//     return [
//         {
//             service: "send_command",
//             domain: "remote",
//             target: {
//                 entity_id: controller_id
//             },
//             data: {
//                 num_repeats: 1,
//                 delay_secs: 0.4,
//                 hold_secs: 0.1,
//                 device,
//                 command: FanCommand.TURN_OFF
//             }
//         }
//     ];
// }

// export function createServiceCall(service, target, inputData, currentState) {
//     switch (service) {
//         case "turn_on":
//             return createOnServiceCall(target, inputData, currentState);
//         case "turn_off":
//             return createOffServiceCall(target, inputData, currentState);
//         default:
//             return undefined;
//     }
// }
