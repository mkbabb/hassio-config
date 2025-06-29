// @ts-ignore
const entities = msg.payload;

// Filter entities based on floor and area criteria
const filteredEntities = entities.filter((entity) => {
    // Check if entity has floor or area_id defined
    const floor = entity.floor || [];
    const areaId = entity.area_id;

    // Include if it's downstairs OR in master bedroom/bathroom OR in bonus room
    return (
        floor.includes("downstairs") ||
        areaId === "master_bedroom" ||
        areaId === "master_bathroom" ||
        areaId === "bonus_room"
    );
});

// @ts-ignore
msg.payload = filteredEntities;
