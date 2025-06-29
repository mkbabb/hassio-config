// @ts-ignore
const payload = msg.payload;

// For ESPresence entities
const ESPPRESENCE_RE = /^.*\.espresense.*/;

const entities = payload.filter(
    (entity) =>
        // Filter out null states, "unknown", and "unavailable"
        !(
            entity.state === null ||
            entity.state === "unknown" ||
            entity.state === "unavailable"
        ) &&
        // Filter out "*.espresense*" entities
        !(entity.entity_id != null && entity.entity_id.match(ESPPRESENCE_RE))
);

// Filter out entities that are singular, but are in a group.
// For example, "light.tv_lights" might be:
/*
    {
        "entity_id": "light.tv_lights",
        "state": "on",
        "attributes": {
            ...
            "entity_id": ["light.playbar_1_huelight", "light.playbar_2_huelight"],
            ...
        },
    }
*/
// We'd want to remove the "light.playbar_1_huelight" and "light.playbar_2_huelight" entities,
// and only keep the "light.tv_lights" entity.

const isGroupEntity = (entity: Hass.State) => {
    return (
        // @ts-ignore
        entity.attributes?.entity_id != null &&
        // @ts-ignore
        Array.isArray(entity.attributes?.entity_id) &&
        // @ts-ignore
        entity.attributes.entity_id.length > 1
    );
};

// First, get the group entities (where the entity_id is an array AND that array has more than 1 element)
const groupEntities = entities.filter(isGroupEntity);

// Then, get the singular entities:
const singularEntities = entities.filter((entity) => !isGroupEntity(entity));

// Then, filter out the singular entities that are in a group:
const filteredEntities = singularEntities.filter(
    (entity) =>
        !groupEntities.some((groupEntity) =>
            // @ts-ignore
            groupEntity.attributes.entity_id.includes(entity.entity_id)
        )
);

const finalEntities = [...filteredEntities, ...groupEntities];

// @ts-ignore
msg.payload = finalEntities;
