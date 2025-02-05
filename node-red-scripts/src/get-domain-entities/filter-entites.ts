// @ts-ignore
const payload = msg.payload;

const ESPPRESENCE_RE = /^.*\.espresense.*/;

const entities = payload.filter(
    (entity) =>
        // Filter out null states, "unknown", "unavailable"
        !(
            entity.state === null ||
            entity.state === "unknown" ||
            entity.state === "unavailable"
        ) &&
        // Filter out "*.espresense*" entities
        !(entity.entity_id != null && entity.entity_id.match(ESPPRESENCE_RE))
);

// @ts-ignore
msg.payload = entities;
