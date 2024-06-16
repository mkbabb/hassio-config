"use strict";
function mapRange(value, fromMin, fromMax, toMin, toMax) {
  return (value - fromMin) * (toMax - toMin) / (fromMax - fromMin) + toMin;
}
function createOnServiceCall(target2, inputData2, currentState2) {
  const { controller_id, device } = target2;
  const MIN_BRIGHTNESS = 0;
  const MAX_BRIGHTNESS = 1;
  const MIN_BRIGHTNESS_LEVELS = 1;
  const MAX_BRIGHTNESS_LEVELS = (
    // @ts-ignore
    parseFloat(msg.payload.entity_attributes.brightness_levels) ?? MIN_BRIGHTNESS_LEVELS
  );
  const mappedInputBrightness = mapRange(
    parseFloat(inputData2.brightness_pct) ?? 0,
    MIN_BRIGHTNESS,
    MAX_BRIGHTNESS,
    MIN_BRIGHTNESS_LEVELS,
    MAX_BRIGHTNESS_LEVELS
  );
  if (mappedInputBrightness === MIN_BRIGHTNESS_LEVELS) {
    return createOffServiceCall(target2, inputData2, currentState2);
  }
  const reverseMappedInputBrightness = mapRange(
    mappedInputBrightness,
    MIN_BRIGHTNESS_LEVELS,
    MAX_BRIGHTNESS_LEVELS,
    MIN_BRIGHTNESS,
    MAX_BRIGHTNESS
  );
  const currentBrightness = mapRange(
    // @ts-ignore
    currentState2.brightness ?? 1,
    MIN_BRIGHTNESS,
    MAX_BRIGHTNESS,
    MIN_BRIGHTNESS_LEVELS,
    MAX_BRIGHTNESS_LEVELS
  );
  let calls = [];
  if (currentState2.brightness === 0 || currentState2.state === "off") {
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
  const brightnessDelta = Math.round(mappedInputBrightness - currentBrightness);
  const brightnessDirection = brightnessDelta < 0 ? "brightness down" : "brightness up";
  currentState2.state = "on";
  currentState2.brightness = reverseMappedInputBrightness;
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
function createOffServiceCall(target2, inputData2, currentState2) {
  const { controller_id, device } = target2;
  currentState2.state = "off";
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
msg.payload.entity_attributes = JSON.parse(msg.payload.entity_attributes);
msg.payload.entity_state = JSON.parse(msg.payload.entity_state);
const service = msg.payload.service;
const currentState = msg.payload.entity_state;
const inputData = msg.payload.data;
const target = msg.payload.target;
const serviceCalls = (() => {
  switch (service) {
    case "turn_on":
      return createOnServiceCall(target, inputData, currentState);
    case "turn_off":
      return createOffServiceCall(target, inputData, currentState);
    default:
      return void 0;
  }
})();
msg.payload = serviceCalls;
msg.entity_state = JSON.stringify(currentState);
msg.entity_state_id = target.entity_state_id;
return msg;
