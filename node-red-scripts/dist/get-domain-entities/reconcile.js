"use strict";
const entities = flow.get("entities");
const areaEntities = flow.get("areaEntities");
const areaEntitiesIds = areaEntities.map((areaEntity) => areaEntity.entity).flat();
const areaEntitiesInArea = entities.filter(
  (entity) => areaEntitiesIds.includes(entity.entity_id)
);
msg.payload = areaEntitiesInArea;
return msg;
