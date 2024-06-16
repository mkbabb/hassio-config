"use strict";
function mapRange(value, fromMin, fromMax, toMin, toMax) {
  return (value - fromMin) * (toMax - toMin) / (fromMax - fromMin) + toMin;
}
const DEFAULT_REMOTE_DATA = {
  num_repeats: 1,
  delay_secs: 0.4,
  hold_secs: 0.1
};
var LightCommand = /* @__PURE__ */ ((LightCommand2) => {
  LightCommand2["TURN_ON"] = "turn on";
  LightCommand2["TURN_OFF"] = "turn off";
  LightCommand2["BRIGHTNESS_UP"] = "brightness up";
  LightCommand2["BRIGHTNESS_DOWN"] = "brightness down";
  LightCommand2["COLOR"] = "color";
  LightCommand2["WHITE"] = "white";
  LightCommand2["EFFECT"] = "effect";
  LightCommand2["TRANSITION"] = "transition";
  return LightCommand2;
})(LightCommand || {});
function createOnServiceCall(target2, inputData2, currentState2, attributes2) {
  const { controller_id, device } = target2;
  const MIN_BRIGHTNESS = 0;
  const MAX_BRIGHTNESS = 1;
  const MIN_BRIGHTNESS_LEVELS = 1;
  const MAX_BRIGHTNESS_LEVELS = (
    // @ts-ignore
    parseFloat(attributes2.brightness_levels) ?? MIN_BRIGHTNESS_LEVELS
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
  let serviceCalls = [];
  if (currentState2.brightness === 0 || currentState2.state === "off") {
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
  const brightnessDelta = Math.round(mappedInputBrightness - currentBrightness);
  const brightnessDirection = brightnessDelta < 0 ? LightCommand.BRIGHTNESS_DOWN : LightCommand.BRIGHTNESS_UP;
  currentState2.state = "on";
  currentState2.brightness = reverseMappedInputBrightness;
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
function createOffServiceCall(target2, inputData2, currentState2, attributes2) {
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
        command: LightCommand.TURN_OFF
      }
    }
  ];
}
function createServiceCall(service2, target2, inputData2, currentState2, attributes2) {
  switch (service2) {
    case "turn_on":
      return createOnServiceCall(target2, inputData2, currentState2, attributes2);
    case "turn_off":
      return createOffServiceCall(target2, inputData2, currentState2);
    default:
      return void 0;
  }
}
msg.payload.entity_attributes = JSON.parse(msg.payload.entity_attributes);
msg.payload.entity_state = JSON.parse(msg.payload.entity_state);
const service = msg.payload.service;
const domain = msg.payload.domain;
const target = msg.payload.target;
const inputData = msg.payload.data;
const currentState = msg.payload.entity_state;
const attributes = msg.payload.entity_attributes;
msg.payload = () => {
  switch (domain) {
    case "light":
      return createServiceCall(
        service,
        target,
        inputData,
        currentState,
        attributes
      );
    default:
      return {};
  }
};
msg.entity_state = JSON.stringify(currentState);
msg.entity_state_id = target.entity_state_id;
return msg;
