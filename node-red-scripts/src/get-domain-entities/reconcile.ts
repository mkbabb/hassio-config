// Each entity is of the form:
/*
{
    "area_id": null,
    "categories": {},
    "config_entry_id": "ec5a8dbb37234640aafc133fcf9145d3",
    "device_id": "1bd27e814ff907a27f4c4b3513eebfe0",
    "disabled_by": null,
    "entity_category": null,
    "entity_id": "weather.home",
    "has_entity_name": true,
    "hidden_by": null,
    "icon": null,
    "id": "cb7943781184ca831a473e57300c79ec",
    "labels": [],
    "name": null,
    "options": {
        "conversation": { "should_expose": false },
        "cloud.alexa": { "should_expose": false },
        "cloud.google_assistant": { "should_expose": false }
    },
    "original_name": "Home",
    "platform": "met",
    "translation_key": null,
    "unique_id": "home"
}
*/

// And each area entity is of the form:
/*
{
        "floor": ["downstairs"],
        "device": [
            "3ce728aa9e4010838f75e1826932469b",
        ],
        "config_entry": [
            "f0ec4ed4e5565ec097e43d8fce87dae1",
        ],
        "entity": [
            "event.kitchen_can_lights_scene_001_2",
        ],
        "scene": ["scene.nighttime"]
    },
*/

// @ts-ignore
const entities = flow.get("entities");
// @ts-ignore
const areaEntities = flow.get("areaEntities");

// filter out entities that are not in an area
const areaEntitiesIds = areaEntities.map((areaEntity) => areaEntity.entity).flat();
const areaEntitiesInArea = entities.filter((entity) =>
    areaEntitiesIds.includes(entity.entity_id)
);

// @ts-ignore
msg.payload = areaEntitiesInArea;
