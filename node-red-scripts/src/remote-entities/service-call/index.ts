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
const { domain, service, action, target, data } = msg.payload;

// Handle both old domain/service format and new action format
const [serviceDomain, serviceName] = (() => {
    if (action) {
        // New format: action = "domain.service"
        const parts = action.split('.');
        return parts.length === 2 ? parts : [domain, service];
    } else {
        // Legacy format: separate domain and service
        return [domain, service];
    }
})();

// @ts-ignore
msg.payload = (() => {
    // Validate service name to prevent 'turn_unavailable' errors
    if (!serviceName || serviceName === 'unavailable' || serviceName.includes('unavailable')) {
        return [];
    }

    const remoteServiceCallPayload: ServiceCallPayload = {
        domain: serviceDomain,
        service: serviceName,
        target,
        data,
        entity_state,
        entity_attributes
    };

    switch (serviceDomain) {
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
