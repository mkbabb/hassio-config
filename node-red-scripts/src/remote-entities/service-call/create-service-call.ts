import * as light from "./light";
import * as fan from "./fan";
import {
    FanServiceCallPayload,
    LightServiceCallPayload,
    ServiceCallPayload
} from "./utils";

//@ts-ignore
const entity_attributes = JSON.parse(msg.payload.entity_attributes);
//@ts-ignore
const entity_state = JSON.parse(msg.payload.entity_state);
// @ts-ignore
const { domain, service, target, data } = msg.payload;

// @ts-ignore
msg.payload = (() => {
    const remoteServiceCallPayload: ServiceCallPayload = {
        domain,
        service,
        target,
        data,
        entity_state,
        entity_attributes
    };

    switch (domain) {
        case "light":
            return light.createServiceCall(
                remoteServiceCallPayload as LightServiceCallPayload
            );
        case "fan":
            return fan.createServiceCall(
                remoteServiceCallPayload as FanServiceCallPayload
            );
        default:
            return [];
    }
})();
// @ts-ignore
msg.entity_state = JSON.stringify(entity_state);
// @ts-ignore
msg.entity_state_id = target.entity_state_id;
