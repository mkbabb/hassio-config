import { groupActions, serviceToActionCall } from "../utils/service-calls";

// @ts-ignore
const states: Partial<Hass.Service>[] = msg.payload;

const actions = groupActions(states.map(serviceToActionCall));

// @ts-ignore
msg.payload = actions;
