/**
 * Get Schedule API - GET /endpoint/schedules/:name
 *
 * Node wiring:
 *   [http-in: GET /endpoint/schedules/:name] → [function: this] → [http-response]
 *
 * Returns a single schedule's full detail including matched entities.
 */

import { getRegistry } from "./registry";
import type { RegistrySchedule } from "../types";
import {
    resolveEntityTime,
    isTimeInRange,
    calculateScheduleTimes,
    calculateProgress
} from "../../utils/datetime";
import { getEntity, getEntitiesByPattern } from "../../utils/entities";
import { normalizeEntityMatch } from "../schedule/entity-matching";

// @ts-ignore - Node-RED global
const message = msg;

const name = message.req?.params?.name;

if (!name) {
    message.payload = { error: "Schedule name is required" };
    message.statusCode = 400;
    // @ts-ignore
    msg = message;
} else {
    const registry = getRegistry();
    const schedule = registry.schedules[name];

    if (!schedule) {
        message.payload = { error: `Schedule "${name}" not found` };
        message.statusCode = 404;
    } else {
        const now = new Date();

        function resolveTime(time: string | { entity_id: string }): string {
            return resolveEntityTime(time, (entityId: string) => getEntity(entityId));
        }

        const startTimeStr = resolveTime(schedule.start);
        const endTimeStr = schedule.end ? resolveTime(schedule.end) : null;
        const scheduleType = schedule.type || "trigger";
        const { start: startTime, end: endTime } = calculateScheduleTimes(
            startTimeStr,
            endTimeStr,
            now,
            scheduleType === "trigger" ? 10 : 0
        );

        let active = false;
        let progress = 0;
        let adjustedStart = startTime;
        let adjustedEnd = endTime;

        if (endTime) {
            adjustedEnd = endTime as Date;
            if (schedule.durationModifier != null && schedule.durationModifier > 0 && schedule.durationModifier < 1) {
                const duration = (adjustedEnd as Date).getTime() - adjustedStart.getTime();
                const newDuration = duration * schedule.durationModifier;
                const offset = (duration - newDuration) / 2;
                adjustedStart = new Date(adjustedStart.getTime() + offset);
                adjustedEnd = new Date((adjustedEnd as Date).getTime() - offset);
            }
            active = isTimeInRange(now, adjustedStart, adjustedEnd as Date);
            progress = active ? calculateProgress(now, adjustedStart, adjustedEnd as Date) : 0;
        }

        // Resolve matched entity IDs
        const matchedEntityIds: string[] = [];
        if (schedule.entities) {
            for (const entityMatch of schedule.entities) {
                const normalized = normalizeEntityMatch(entityMatch);
                for (const config of normalized) {
                    const matches = getEntitiesByPattern(config.pattern);
                    for (const match of matches) {
                        if (!matchedEntityIds.includes(match.entity_id)) {
                            matchedEntityIds.push(match.entity_id);
                        }
                    }
                }
            }
        }

        message.payload = {
            name: schedule.name,
            source: schedule.source,
            enabled: schedule.enabled,
            type: schedule.type || "trigger",
            precedence: schedule.precedence,
            start: schedule.start,
            end: schedule.end,
            startResolved: startTimeStr,
            endResolved: endTimeStr,
            active,
            progress: Math.round(progress * 1000) / 1000,
            conditions: schedule.conditions || [],
            entities: schedule.entities || [],
            tags: schedule.tags || [],
            durationModifier: schedule.durationModifier,
            interpolation: schedule.interpolation,
            defaultStates: schedule.defaultStates,
            matchedEntityIds,
            matchedEntityCount: matchedEntityIds.length,
            createdAt: schedule.createdAt,
            updatedAt: schedule.updatedAt,
            helperEntities: schedule.helperEntities
        };
        message.statusCode = 200;
    }

    // @ts-ignore
    msg = message;
}
