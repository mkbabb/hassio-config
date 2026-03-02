/**
 * DateTime utilities for Node-RED scheduling
 * Centralized date/time handling functions
 */

// Time string parsing and formatting

export function getTimeComponents(time: string): [number, number, number] {
    const timeParts = time.split(":");
    const [hours, mins, seconds] = timeParts
        .concat(Array(3 - timeParts.length).fill("00"))
        .map((x) => parseInt(x, 10));
    return [hours, mins, seconds];
}

export function normalizeTime(time: string): string {
    const [hours, mins, seconds] = getTimeComponents(time);
    return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

export function dateToTimeString(date: Date): string {
    return `${date.getHours()}:${date.getMinutes().toString().padStart(2, '0')}`;
}

export function timeStringToDate(time: string): Date {
    const normalizedTime = normalizeTime(time);
    const [hours, mins, seconds] = getTimeComponents(normalizedTime);
    
    const date = new Date();
    date.setHours(hours, mins, seconds, 0);
    return date;
}

// Time comparison and range checking

export function compareTime(time1: Date, time2: Date, withDay: boolean = false): number {
    if (withDay) {
        // Compare full timestamps when day matters
        const ts1 = time1.getTime();
        const ts2 = time2.getTime();
        return ts1 === ts2 ? 0 : ts1 > ts2 ? 1 : -1;
    }

    // Compare only time of day (ignore date)
    const t1 = time1.getHours() * 3600 + time1.getMinutes() * 60 + time1.getSeconds();
    const t2 = time2.getHours() * 3600 + time2.getMinutes() * 60 + time2.getSeconds();

    return t1 === t2 ? 0 : t1 > t2 ? 1 : -1;
}

export function isTimeInRange(current: Date, start: Date, end: Date): boolean {
    return compareTime(current, start, true) >= 0 && compareTime(current, end, true) <= 0;
}

// Time window calculations

export function isWithinWindow(current: Date, target: Date, windowMs: number): boolean {
    return Math.abs(current.getTime() - target.getTime()) <= windowMs;
}

// Date manipulation

export function adjustDateForSchedule(time: Date, reference: Date, isStart: boolean): Date {
    const adjusted = new Date(time);
    adjusted.setFullYear(reference.getFullYear(), reference.getMonth(), reference.getDate());
    
    // Handle schedules that span midnight
    const refTime = reference.getHours() * 3600 + reference.getMinutes() * 60 + reference.getSeconds();
    const schedTime = adjusted.getHours() * 3600 + adjusted.getMinutes() * 60 + adjusted.getSeconds();
    
    if (isStart && schedTime > refTime) {
        // Start time is later than current time - might be yesterday
        adjusted.setDate(adjusted.getDate() - 1);
    } else if (!isStart && schedTime < refTime && schedTime < 12 * 3600) {
        // End time is earlier than current and in morning - might be tomorrow
        adjusted.setDate(adjusted.getDate() + 1);
    }
    
    return adjusted;
}

export function handleMidnightSpan(start: Date, end: Date, now: Date): [Date, Date] {
    const startCopy = new Date(start);
    const endCopy = new Date(end);

    // Set both to today's date initially
    startCopy.setFullYear(now.getFullYear(), now.getMonth(), now.getDate());
    endCopy.setFullYear(now.getFullYear(), now.getMonth(), now.getDate());

    // Check if schedule spans midnight by comparing times
    const spansMidnight = compareTime(startCopy, endCopy) >= 0;

    if (spansMidnight) {
        // Schedule spans midnight (e.g., 18:00 to 08:00)
        if (compareTime(now, endCopy) < 0) {
            // Current time is before end time (e.g., 02:00 < 08:00)
            // We're in the early morning part of the span
            // Start should be yesterday
            startCopy.setDate(startCopy.getDate() - 1);
        } else {
            // Current time is at or after end time (e.g., 22:00 >= 08:00)
            // We're in the evening part of the span
            // End should be tomorrow
            endCopy.setDate(endCopy.getDate() + 1);
        }
    } else {
        // Schedule doesn't span midnight (e.g., 08:00 to 18:00)
        if (compareTime(now, endCopy) > 0) {
            // Already past end time today, move entire schedule to tomorrow
            startCopy.setDate(startCopy.getDate() + 1);
            endCopy.setDate(endCopy.getDate() + 1);
        }
        // Otherwise, schedule is today (or in progress today)
    }

    return [startCopy, endCopy];
}

// Schedule-specific utilities

export function createScheduleWindow(startTime: Date, windowMinutes: number = 10): Date {
    const endTime = new Date(startTime.getTime() + windowMinutes * 60 * 1000);
    return endTime;
}

export function calculateScheduleTimes(
    startTimeStr: string,
    endTimeStr: string | null,
    now: Date,
    defaultWindowMinutes: number = 10
): { start: Date; end: Date } {
    const start = timeStringToDate(startTimeStr);
    let end: Date;
    
    if (endTimeStr) {
        end = timeStringToDate(endTimeStr);
    } else {
        // No end time specified - create a window
        end = createScheduleWindow(start, defaultWindowMinutes);
    }
    
    // Adjust for current date and handle midnight spans
    const [adjustedStart, adjustedEnd] = handleMidnightSpan(start, end, now);
    
    return { start: adjustedStart, end: adjustedEnd };
}

// Interpolation utilities

export function calculateProgress(current: Date, start: Date, end: Date): number {
    const currentMs = current.getTime();
    const startMs = start.getTime();
    const endMs = end.getTime();
    
    if (currentMs <= startMs) return 0;
    if (currentMs >= endMs) return 1;
    
    const progress = (currentMs - startMs) / (endMs - startMs);
    return Math.min(1, Math.max(0, progress));
}

// Current time utilities

export function getCurrentTimeString(): string {
    return dateToTimeString(new Date());
}

export function getTimeUntil(target: Date, from: Date = new Date()): number {
    return target.getTime() - from.getTime();
}

export function getTimeString(): string {
    const timeObject = new Date(Date.now());
    const hours = String(timeObject.getHours()).padStart(2, '0');
    const minutes = String(timeObject.getMinutes()).padStart(2, '0');
    const seconds = String(timeObject.getSeconds()).padStart(2, '0');
    
    return `${hours}:${minutes}:${seconds}`;
}

// Entity time resolution

export function resolveEntityTime(
    time: string | { entity_id: string },
    entityLookup: (entityId: string) => any | undefined
): string {
    if (typeof time === "string") {
        // Direct time string or possible entity reference
        if (time.includes(":")) {
            // Looks like a time string
            return time;
        }
        // Try to look up as entity ID
        const entity = entityLookup(time);
        if (entity?.state) {
            return entity.state;
        }
        return time;
    } else if (time && typeof time === "object" && "entity_id" in time) {
        // Entity reference object
        const entity = entityLookup(time.entity_id);
        if (entity?.state) {
            return entity.state;
        }
        throw new Error(`Entity '${time.entity_id}' not found`);
    }
    
    throw new Error(`Invalid time format: ${JSON.stringify(time)}`);
}

// Week/Day utilities

/**
 * Convert JavaScript getDay() (0=Sun) to Python weekday() (0=Mon)
 * Used to match Home Assistant template logic
 */
export function getPythonWeekday(date: Date = new Date()): number {
    return (date.getDay() + 6) % 7;
}

/**
 * Determine if date falls on a weekday (Mon-Fri)
 * Matches HA template: {% if now().weekday() < 5 %}
 */
export function isWeekday(date: Date = new Date()): boolean {
    return getPythonWeekday(date) < 5;
}

// Duration formatting

/** Format minutes to human-readable: <1 min, X min, Y.Z hr, A.B day */
export const formatDuration = (minutes: number): string => {
    if (minutes < 1) return "<1 min";
    if (minutes < 60) return `${Math.round(minutes)} min`;
    const hours = minutes / 60;
    if (hours < 24) return `${Math.round(hours * 10) / 10} hr`;
    const days = hours / 24;
    return `${Math.round(days * 10) / 10} day`;
};

// Cleanup utilities

export function isStale(timestamp: string | Date, maxAgeMs: number): boolean {
    const time = typeof timestamp === "string" ? new Date(timestamp) : timestamp;
    return Date.now() - time.getTime() > maxAgeMs;
}

export function cleanupOldEntries<T extends { [key: string]: any }>(
    entries: T,
    getTimestamp: (value: any) => string | Date | null,
    maxAgeMs: number = 24 * 60 * 60 * 1000 // 24 hours default
): T {
    const cleaned = {} as T;
    
    Object.entries(entries).forEach(([key, value]) => {
        const timestamp = getTimestamp(value);
        if (timestamp && !isStale(timestamp, maxAgeMs)) {
            cleaned[key as keyof T] = value;
        }
    });
    
    return cleaned;
}