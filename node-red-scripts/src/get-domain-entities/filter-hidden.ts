// The payload is an array of entities, each entity is of the form (example data):
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

// @ts-ignore
const payload = msg.payload;
// @ts-ignore
const domains = flow.get("domains");

// We want to extract the entity_id from each entity only if "hidden_by" is null:
const entities = payload
    .filter((entity) => entity.hidden_by === null)
    // filter out the domain
    .filter((entity) => {
        const domain = entity.entity_id.split(".")[0];
        return domains.includes(domain);
    });

// @ts-ignore
msg.payload = entities;
