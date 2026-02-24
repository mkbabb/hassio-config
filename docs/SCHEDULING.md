# Scheduling Engine

Precedence-based, time-window automation engine. Evaluates all entities against enabled schedules every 1-5 minutes, generating service actions for lights, switches, covers, locks, and climate.

## How It Works

```
Registry (global context)          Entity States (HA API)
        │                                   │
        ▼                                   ▼
┌──────────────────────────────────────────────────┐
│              Schedule Engine                       │
│  1. Load registry + resolve times from entities   │
│  2. Apply durationModifier (centered shrink)      │
│  3. Check conditions (presence, entity state)     │
│  4. Match entities (regex + tags + exact IDs)     │
│  5. Resolve precedence (highest wins per entity)  │
│  6. Generate actions (continuous vs trigger)       │
│  7. Calculate interpolation events (ramp phases)  │
│  8. Deduplicate (skip if already in target state) │
└──────────────────────────────────────────────────┘
        │                    │                │
        ▼                    ▼                ▼
   Service Actions     ScheduleEvents     InfluxDB
   (turn_on/off)       (t=0-1, phase)     Logging
```

## Schedule Types

**Continuous** — enforce state throughout active window. If a light is off during an active continuous schedule, it gets turned on. Used for plants, day/night.

**Trigger** — fire once at start and/or end, with a ±10 minute tolerance window. Used for blinds (open at wakeup) and locks (lock at bedtime).

## Registry

All schedules live in `global.get("scheduleRegistry")`:

```typescript
interface ScheduleRegistry {
  version: number;
  schedules: Record<string, RegistrySchedule>;
  tagDefinitions: Record<string, string[]>;
  lastSeeded: string;    // ISO timestamp
}

interface RegistrySchedule extends Schedule {
  source: "static" | "dynamic";
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}
```

Static schedules are seeded on Node-RED startup from TypeScript arrays. Dynamic schedules are created via the REST API. Static schedules cannot be deleted (only disabled).

## Current Schedules

| Name | Type | Precedence | Window | Entities | Conditions |
|------|------|-----------|--------|----------|------------|
| `plants_global` | continuous | 100 | 6AM-11PM (input_datetime) | `regex:(switch\|light)\..*grow.*` | — |
| `plants_shelf` | continuous | 105 | Same, `durationModifier: 0.5` | 3 shelf grow lights | — |
| `bedroom_plants` | continuous | 110 | Wakeup-Sleep (sensor) | `regex:.*bedroom.*grow.*` | — |
| `warocqueanum_home_morning` | continuous | 120 | 06:00-10:00 | light.titanic_light | home |
| `warocqueanum_home_midday` | continuous | 120 | 12:00-14:00 | light.titanic_light | home |
| `warocqueanum_home_afternoon` | continuous | 120 | 16:00-18:30 | light.titanic_light | home |
| `warocqueanum_home_evening` | continuous | 120 | 20:00-22:00 | light.titanic_light | home |
| `warocqueanum_away` | continuous | 30 | 06:00-23:00 | light.titanic_light | away |
| `day_status` | continuous | 80 | Wakeup-Sleep | input_select.day_status | — |
| `blinds_day_schedule` | trigger | 70 | Wakeup-Sunset | cover.* | home |
| `blinds_night_schedule` | continuous | 71 | Sunset-Wakeup | cover.* | home |
| `night_auto_lock` | trigger | 100 | 23:00 | lock.* | asleep |
| `early_morning_lock` | trigger | 100 | 04:00 | lock.* | asleep |

## Precedence Resolution

When multiple schedules match the same entity, highest `precedence` wins. Example: `light.pikachu_grow_light` matches both `plants_global` (100) and `plants_shelf` (105). Shelf wins.

## Duration Modifier

`durationModifier: 0.5` shrinks the schedule window to 50% of its original length, **centered**. If global is 6AM-11PM (17h), shelf becomes ~8:30AM-8:30PM (8.5h).

```
Global:  |--6AM================================================11PM--|
Shelf:   |         8:30AM========================8:30PM               |
```

## Interpolation (Sunrise/Sunset Sim)

Schedules with `interpolation.enabled` get preamble/postamble phases:

```
      preamble        active           postamble
   ┌───────────┬──────────────────┬───────────────┐
   │  ramp_up  │     active       │  ramp_down    │
   │  t: 0→1   │     t: 0→1      │  t: 1→0       │
   └───────────┴──────────────────┴───────────────┘
```

`simulate-sun.ts` uses `t` to interpolate brightness (1→255) and color temperature (2200K→3000K warm→cool).

## REST API

Base: `http://homeassistant.local:1880/endpoint`

| Method | Path | Handler | Purpose |
|--------|------|---------|---------|
| GET | `/schedules/` | list-schedules.ts | All schedules with resolved times |
| GET | `/schedules/:name` | get-schedule.ts | Single schedule + matched entities |
| POST | `/schedules/` | create-schedule.ts | Create dynamic schedule |
| PUT | `/schedules/:name` | update-schedule.ts | Update (static: enabled/precedence only) |
| DELETE | `/schedules/:name` | delete-schedule.ts | Delete dynamic (403 for static) |
| GET | `/schedule-status` | schedule-status.ts | Active/pending/inactive breakdown |

## Published Sensors

Published via `POST /api/states/` (REST API sensors — vanish on HA restart, repopulate in ~30s):

| Sensor | State | Key Attributes |
|--------|-------|---------------|
| `sensor.schedule_{name}_status` | active/inactive/ramp_up/ramp_down | t, phase, start_time, end_time |
| `sensor.schedule_{name}_progress` | 0.0-1.0 | — |
| `sensor.active_schedule_count` | integer | active_names |
| `sensor.schedule_engine_last_run` | ISO timestamp | duration_ms, actions_generated |

## Files

```
src/scheduling/
├── types.ts                    (112 LOC) — Schedule, RegistrySchedule, ScheduleEvent
├── schedule/
│   ├── index.ts                (497 LOC) — Main engine
│   ├── conditions.ts            (43 LOC) — Presence/state condition checks
│   ├── entity-matching.ts      (154 LOC) — Regex/tag/exact matching
│   ├── schedule-processing.ts   (93 LOC) — Continuous vs trigger logic
│   ├── state-mapping.ts        (142 LOC) — Domain→state→service resolution
│   └── schedules/
│       ├── index.ts             (64 LOC) — Registry seeding
│       ├── plants-schedules.ts (136 LOC) — 9 plant schedules
│       ├── day-night-schedules.ts (33 LOC)
│       ├── blinds-schedules.ts  (38 LOC)
│       └── lock-schedules.ts    (31 LOC)
├── api/
│   ├── registry.ts              (74 LOC) — CRUD utilities
│   ├── validation.ts           (183 LOC) — Schema validation
│   ├── list-schedules.ts       (106 LOC)
│   ├── get-schedule.ts         (118 LOC)
│   ├── create-schedule.ts       (73 LOC)
│   ├── update-schedule.ts       (88 LOC)
│   ├── delete-schedule.ts       (36 LOC)
│   └── schedule-status.ts      (129 LOC)
├── publish-schedule-state.ts   (214 LOC) — Sensor publishing with dedup
├── simulate-sun.ts             (304 LOC) — Brightness/color interpolation
├── cache-schedule-entity.ts    (137 LOC) — input_datetime caching
├── pop-schedule-entites.ts      (19 LOC) — Cached time retrieval
└── influx-logger.ts             (83 LOC) — schedule_events measurement
```

## Node-RED Flow Tab

**Scheduler ⏳** (`test_scheduler_1753565985859`) — 36 nodes:
- 10s inject timer → schedules (registry seed) → schedule (engine) → simulate-sun → service calls
- Schedule engine → publish-schedule-state → switch (null check) → split → ha-api
- 6 http-in/function/http-response chains for REST API
