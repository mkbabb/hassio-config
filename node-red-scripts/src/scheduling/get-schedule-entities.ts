// Get all input_datetime entities for schedule overrides

// @ts-ignore
const states = global.get("homeAssistant.homeAssistant.states");

if (!states) {
    // @ts-ignore
    msg.payload = [];
} else {

// Get all input_datetime entities
const scheduleEntities = Object.keys(states)
    .filter(entityId => entityId.startsWith("input_datetime."))
    .map(entityId => ({
        entity_id: entityId,
        state: states[entityId].state,
        attributes: states[entityId].attributes
    }));

    // @ts-ignore
    msg.schedule_entities = scheduleEntities;
    // @ts-ignore
    msg.payload = scheduleEntities;
}

// @ts-ignore