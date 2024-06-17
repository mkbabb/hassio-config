"use strict";
function mapRange(value, fromMin, fromMax, toMin, toMax) {
  return (value - fromMin) * (toMax - toMin) / (fromMax - fromMin) + toMin;
}
const parseFloatIfString = (value) => {
  return typeof value === "string" ? parseFloat(value) : value;
};
const DEFAULT_REMOTE_DATA = {
  num_repeats: 1,
  delay_secs: 0.1,
  hold_secs: 0.05
};
var LightCommand = /* @__PURE__ */ ((LightCommand2) => {
  LightCommand2["TURN_ON"] = "turn_on";
  LightCommand2["TURN_OFF"] = "turn_off";
  LightCommand2["BRIGHTNESS_UP"] = "increase_brightness";
  LightCommand2["BRIGHTNESS_DOWN"] = "decrease_brightness";
  LightCommand2["TEMPERATURE_UP"] = "increase_color_temp";
  LightCommand2["TEMPERATURE_DOWN"] = "decrease_color_temp";
  return LightCommand2;
})(LightCommand || {});
var FanCommand = /* @__PURE__ */ ((FanCommand2) => {
  FanCommand2["TURN_ON"] = "turn_on";
  FanCommand2["TURN_OFF"] = "turn_off";
  FanCommand2["INCREASE_SPEED"] = "increase_speed";
  FanCommand2["DECREASE_SPEED"] = "decrease_speed";
  FanCommand2["OSCILLATE_ON"] = "oscillate_on";
  FanCommand2["OSCILLATE_OFF"] = "oscillate_off";
  FanCommand2["SET_PRESET_MODE"] = "set_preset_mode";
  return FanCommand2;
})(FanCommand || {});
const MIN_LEVEL = 1;
const MIN_PERCENTAGE = 0;
const MAX_PERCENTAGE = 100;
const MIN_COLOR_TEMP = 154;
const MAX_COLOR_TEMP = 500;
const MIN_UNIT = 0;
const MAX_UNIT = 1;
const MIN_BINARY = 0;
const MAX_BINARY = 255;
const MIN_STEP = -1;
const MAX_STEP = 1;
function mapInputBrightness(payload, maxLevel) {
  const { data: data2 } = payload;
  const [brightnessString, minBrightness, maxBrightness] = (() => {
    if (data2.brightness) {
      return [data2.brightness, MIN_BINARY, MAX_BINARY];
    } else if (data2.brightness_pct) {
      return [data2.brightness_pct, MIN_PERCENTAGE, MAX_PERCENTAGE];
    } else if (data2.brightness_step) {
      return [data2.brightness_step, MIN_STEP, MAX_STEP];
    } else {
      return [void 0, MIN_UNIT, MAX_UNIT];
    }
  })();
  const brightness = parseFloatIfString(brightnessString);
  return mapRange(brightness, minBrightness, maxBrightness, MIN_LEVEL, maxLevel);
}
function isLightServiceCallPayload(payload) {
  return payload.domain === "light";
}
function isFanServiceCallPayload(payload) {
  return payload.domain === "fan";
}
function getLightPayloadValues(payload, commandType) {
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
function getFanPayloadValues(payload, commandType) {
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
    currentValue = parseFloatIfString(payload.entity_state.speed);
  }
  return { maxLevel, currentValue, mappedInputValue };
}
function calcPayloadAttributeState(payload, commandType) {
  const DEFAULT_PAYLOAD = {
    currentValue: void 0,
    reverseMappedInputValue: void 0,
    delta: void 0,
    percentage: void 0
  };
  const { maxLevel, currentValue, mappedInputValue } = (() => {
    if (isLightServiceCallPayload(payload)) {
      return getLightPayloadValues(payload, commandType);
    } else if (isFanServiceCallPayload(payload)) {
      return getFanPayloadValues(payload, commandType);
    }
  })();
  if (mappedInputValue == void 0) {
    return DEFAULT_PAYLOAD;
  }
  const currentMappedValue = mapRange(
    currentValue,
    MIN_UNIT,
    MAX_UNIT,
    MIN_LEVEL,
    maxLevel
  );
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
function createOnServiceCall$1(payload) {
  let serviceCalls = [];
  const { controller_id, device } = payload.target;
  const { entity_state: entity_state2, data: data2 } = payload;
  const {
    currentValue: currentBrightness,
    reverseMappedInputValue: reverseMappedInputBrightness,
    delta: brightnessDelta,
    percentage: brightnessPercentage
  } = calcPayloadAttributeState(payload, "brightness");
  if (currentBrightness === 0 || entity_state2.state === "off") {
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
  } else if (brightnessPercentage === 0) {
    return createOffServiceCall$1(payload);
  }
  if (reverseMappedInputBrightness != void 0 && !Number.isNaN(reverseMappedInputBrightness)) {
    const brightnessDirection = brightnessDelta > 0 ? LightCommand.BRIGHTNESS_UP : LightCommand.BRIGHTNESS_DOWN;
    entity_state2.brightness = reverseMappedInputBrightness;
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
  if (reverseMappedInputColorTemp != void 0 && !Number.isNaN(reverseMappedInputColorTemp)) {
    const colorTempDirection = colorTempDelta > 0 ? LightCommand.TEMPERATURE_DOWN : LightCommand.TEMPERATURE_UP;
    entity_state2.color_temp = reverseMappedInputColorTemp;
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
  entity_state2.state = "on";
  return serviceCalls;
}
function createOffServiceCall$1(payload) {
  const { controller_id, device } = payload.target;
  const { entity_state: entity_state2 } = payload;
  entity_state2.state = "off";
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
function createToggleServiceCall$1(payload) {
  const { entity_state: entity_state2 } = payload;
  const newState = entity_state2.state === "off" ? "on" : "off";
  const serviceCall = entity_state2.state === "off" ? createOnServiceCall$1(payload) : createOffServiceCall$1(payload);
  entity_state2.state = newState;
  return serviceCall;
}
function createServiceCall$1(payload) {
  switch (payload.service) {
    case "turn_on":
      return createOnServiceCall$1(payload);
    case "turn_off":
      return createOffServiceCall$1(payload);
    case "toggle":
      return createToggleServiceCall$1(payload);
    default:
      return void 0;
  }
}
function createOnServiceCall(payload) {
  let serviceCalls = [];
  const { controller_id, device } = payload.target;
  const { entity_state: entity_state2 } = payload;
  const {
    currentValue: currentSpeed,
    reverseMappedInputValue: reverseMappedInputSpeed,
    delta: speedDelta,
    percentage: speedPercentage
  } = calcPayloadAttributeState(payload, "speed");
  if (currentSpeed === 0 || entity_state2.state === "off") {
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
  } else if (speedPercentage === 0) {
    return createOffServiceCall(payload);
  }
  if (reverseMappedInputSpeed != void 0) {
    const speedDirection = speedDelta > 0 ? FanCommand.INCREASE_SPEED : FanCommand.DECREASE_SPEED;
    entity_state2.speed = reverseMappedInputSpeed;
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
  entity_state2.state = "on";
  return serviceCalls;
}
function createOffServiceCall(payload) {
  const { controller_id, device } = payload.target;
  const { entity_state: entity_state2 } = payload;
  entity_state2.state = "off";
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
function createToggleServiceCall(payload) {
  const { entity_state: entity_state2 } = payload;
  const newState = entity_state2.state === "off" ? "on" : "off";
  const serviceCall = entity_state2.state === "off" ? createOnServiceCall(payload) : createOffServiceCall(payload);
  entity_state2.state = newState;
  return serviceCall;
}
function setPresetModeServiceCall(payload) {
  const { controller_id, device } = payload.target;
  const { data: data2 } = payload;
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
        command: data2.preset_mode
      }
    }
  ];
}
function oscillateServiceCall(payload) {
  const { controller_id, device } = payload.target;
  const { data: data2, entity_state: entity_state2 } = payload;
  entity_state2.oscillating = data2.oscillating;
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
        command: data2.oscillating ? FanCommand.OSCILLATE_ON : FanCommand.OSCILLATE_OFF
      }
    }
  ];
}
function increaseSpeedServiceCall(payload) {
  const { controller_id, device } = payload.target;
  const { data: data2 } = payload;
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
        num_repeats: data2.percentage_step
      }
    }
  ];
}
function decreaseSpeedServiceCall(payload) {
  const { controller_id, device } = payload.target;
  const { data: data2 } = payload;
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
        num_repeats: data2.percentage_step
      }
    }
  ];
}
function createServiceCall(payload) {
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
      return void 0;
  }
}
const entity_attributes = JSON.parse(msg.payload.entity_attributes);
const entity_state = JSON.parse(msg.payload.entity_state);
const { domain, service, target, data } = msg.payload;
msg.payload = (() => {
  const remoteServiceCallPayload = {
    domain,
    service,
    target,
    data,
    entity_state,
    entity_attributes
  };
  switch (domain) {
    case "light":
      return createServiceCall$1(
        remoteServiceCallPayload
      );
    case "fan":
      return createServiceCall(
        remoteServiceCallPayload
      );
    default:
      return [];
  }
})();
msg.entity_state = JSON.stringify(entity_state);
msg.entity_state_id = target.entity_state_id;
return msg;
