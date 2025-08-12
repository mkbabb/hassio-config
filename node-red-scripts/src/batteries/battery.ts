/**
 * Process Home Assistant entities with batteries
 * Creates normalized payload for battery notifications
 */

// Create notification content
const LOW_BATTERY_THRESHOLD = 30; // Consider batteries below 30% as low
const CRITICAL_BATTERY_THRESHOLD = 15; // Consider batteries below 15% as critical

// @ts-ignore
const message = msg;
let entities: Hass.State[] = Array.isArray(message.payload)
    ? message.payload
    : [message.payload];

// Dedeupe entities by entity_id
const uniqueEntities = new Map<string, Hass.State>();
entities.forEach((entity) => {
    if (!uniqueEntities.has(entity.entity_id)) {
        uniqueEntities.set(entity.entity_id, entity);
    }
});
entities = Array.from(uniqueEntities.values());

/**
 * Get battery state from entity
 * Handles different formats where battery info could be stored
 */
function getBatteryState(entity: Hass.State): number | null {
    // Case 1: Entity is a battery sensor where the state itself is the battery level
    if (entity.entity_id.includes("battery") && !isNaN(Number(entity.state))) {
        return Number(entity.state);
    }

    // Case 2: Entity has battery_level in attributes
    if (
        "battery_level" in entity.attributes &&
        !isNaN(Number(entity.attributes.battery_level))
    ) {
        return Number(entity.attributes.battery_level);
    }

    // No battery info found
    return null;
}

/**
 * Check if entity should be included in battery report
 */
function isBatteryEntity(entity: Hass.State): boolean {
    // Filter out device trackers
    if (entity.entity_id.startsWith("device_tracker.")) {
        return false;
    }

    // Include if it has battery info
    return getBatteryState(entity) !== null;
}

// Filter and normalize entities
const batteryEntities = entities.filter(isBatteryEntity).map((entity) => {
    const batteryState = getBatteryState(entity);

    return {
        entity_id: entity.entity_id,
        friendly_name: (entity.attributes as any)?.friendly_name || entity.entity_id,
        state: batteryState,
        // Include all other original keys
        ...entity
    };
});

// Sort by battery level (ascending, so lowest batteries first)
batteryEntities.sort((a, b) => {
    // @ts-ignore
    return (a.state || 0) - (b.state || 0);
});

const lowBatteries = batteryEntities.filter(
    (e) =>
        // @ts-ignore
        e.state !== null && e.state < LOW_BATTERY_THRESHOLD
);

if (lowBatteries.length === 0) {
    //@ts-ignore
    msg = null;
} else {
    // Format notification content
    let notificationTitle = "Home Assistant Battery Report";
    let notificationMessage = "";

    const criticalBatteries = lowBatteries.filter(
        // @ts-ignore
        (e) => e.state < CRITICAL_BATTERY_THRESHOLD
    );

    if (criticalBatteries.length > 0) {
        notificationTitle = "⚠️ Critical Battery Levels";
        notificationMessage = criticalBatteries
            .map((e) => `${e.friendly_name}: ${e.state}%`)
            .join("\n");
    } else {
        notificationTitle = "🔋 Low Battery Levels";
        notificationMessage = lowBatteries
            .map((e) => `${e.friendly_name}: ${e.state}%`)
            .join("\n");
    }

    // Prepare the output message
    // @ts-ignore
    msg.payload = {
        batteryEntities,
        notification: {
            title: notificationTitle,
            message: notificationMessage,
            data: {
                push: {
                    category: "battery-alert"
                },
                entity_id: batteryEntities.map((e) => e.entity_id)
            }
        }
    };

    // Include full list for debugging or additional processing
    // @ts-ignore
    msg.batteryReport = {
        entities: batteryEntities,
        total: batteryEntities.length,
        lowCount: lowBatteries.length
    };
}
