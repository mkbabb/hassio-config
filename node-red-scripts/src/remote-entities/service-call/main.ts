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
import * as light from "./light";
import * as fan from "./fan";

//@ts-ignore
msg.payload.entity_attributes = JSON.parse(msg.payload.entity_attributes);
//@ts-ignore
msg.payload.entity_state = JSON.parse(msg.payload.entity_state);

//@ts-ignore
const service = msg.payload.service;
//@ts-ignore
const domain = msg.payload.domain;

//@ts-ignore
const target = msg.payload.target;
//@ts-ignore
const inputData = msg.payload.data;
//@ts-ignore
const currentState = msg.payload.entity_state;
//@ts-ignore
const attributes = msg.payload.entity_attributes;

// @ts-ignore
msg.payload = () => {
    switch (domain) {
        case "light":
            return light.createServiceCall(
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
// @ts-ignore
msg.entity_state = JSON.stringify(currentState);
// @ts-ignore
msg.entity_state_id = target.entity_state_id;
