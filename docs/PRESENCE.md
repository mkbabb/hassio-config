# Presence Detection

Room-level occupancy detection with a 5-state DFA, dynamic cooldown, sensor aggregation, and data-driven area configuration.

## State Machine

```
         motion detected
    OFF ──────────────────> ON
     ▲                       │
     │                       │ all sensors clear
     │ delay expires         ▼
     └──────────────── PENDING_OFF ──motion──> ON
                             │
                         (cooldown)

    UNKNOWN: all sensors unavailable
    RESET: manual override (admin/debug)
```

**Critical rule**: `PENDING_OFF` is treated as `OFF` for re-triggering. If motion fires during cooldown, it cancels the pending turn-off and transitions back to `ON`.

## Cooldown Formula

```
coolDown(ms) = min(MAX_COOL_DOWN, baseCoolDown + sqrt(dwellMinutes) × 120) × 1000
```

- Base: 10 minutes (600s)
- Maximum: 30 minutes (1800s)
- Longer occupancy = longer hysteresis (square root curve, not linear)

## Presence Areas (9 rooms)

| Area | Sensors | Controlled Entities | Cooldown |
|------|---------|---------------------|----------|
| bonus_room | 2 motion | — | 600s |
| downstairs_bathroom | 2 motion | light.downstairs_bathroom_light | 600s |
| garage | 4 (door+motion+obstruction) | — | 600s |
| guest_bathroom | 1 motion | — | 600s |
| guest_bedroom | 1 motion | — | 600s |
| laundry_room | 3 motion | light.laundry_room_light | 600s |
| master_bathroom | 3 motion | — | 600s |
| plant_room | 2 motion | — | 600s |
| upstairs_hall | 2 motion | light.upstairs_hallway_lights, light.flower_lamp | 600s |

Areas are defined in `seed-registry.ts` and stored in `global.get("presenceRegistry")`.

## Sensor Aggregation

- **Any sensor = "on"** → presence state = ON
- **All sensors = "unknown"** → UNKNOWN
- **All sensors off/mixed** → OFF

## Pathological Sequence Detection

The DFA tracks 3 state levels (`state`, `prevState`, `prevPrevState`) to detect the ON→UNKNOWN→OFF pattern — typically caused by a sensor going unavailable briefly. When detected, the turn-off action is suppressed.

## Flow Context (per room)

Stored as `flow.get("flowInfo.{topic}")` within the Presence Subflow instance:

```typescript
{
  state: "on" | "off" | "pending_off" | "unknown",
  prevState: string,
  prevPrevState: string,
  lastOn: number,           // timestamp ms
  lastOff: number,
  delay: number,            // current cooldown ms
  coolDownEndTime: number   // absolute expiry
}
```

**Known limitation**: Per-room state lives in subflow-instance flow context, making it inaccessible from API endpoints on other tabs. The API endpoints (`area-status.ts`) attempt `flow.get()` but get empty results. Fix: migrate to `global.set("presenceFlowInfo.{topic}")`.

## REST API

| Method | Path | Handler |
|--------|------|---------|
| GET | `/presence/` | list-areas.ts — All areas with runtime state |
| GET | `/presence/:topic/status` | area-status.ts — Full flow state for one area |
| POST | `/presence/` | configure-area.ts — Create/update area config |

## Published Sensors

| Sensor | State | Key Attributes |
|--------|-------|---------------|
| `sensor.presence_{topic}_state` | on/off/pending_off/unknown | dwell_minutes, cooldown_remaining_min, sensors_on |
| `sensor.presence_{topic}_cooldown` | float (minutes remaining) | end_time, total_seconds |

**Known issue**: Publisher may not receive messages due to wiring within the subflow chain. Needs verification after motion events.

## Namespace Blacklist

Presence-tracked entities are registered in the `"presence"` namespace of the static-states blacklist system (`seed-registry.ts`). This means:

- **Schedule engine** skips them (already calls `shouldFilterEntity()`)
- **Cache-states** excludes them from home restoration (away still turns them off)
- **Scene rollback** excludes them from captures

This eliminates the need for the old 10-node reset hack on the Presence tab.

## Files

```
src/presence/
├── types.ts                     (29 LOC) — PresenceAreaConfig, PresenceRegistry
├── presence.ts                 (360 LOC) — Core state machine
├── debounce.ts                  (48 LOC) — 1s input / 30s reset debounce
├── get-flow-info.ts             (63 LOC) — Cooldown check at trigger time
├── get-flow-info-logger.ts      (88 LOC) — get_flow_info_events logging
├── influx-logger.ts            (130 LOC) — presence_events logging
├── seed-registry.ts            (179 LOC) — 9 area definitions + blacklist
├── publish-presence-state.ts   (119 LOC) — Sensor publishing with dedup
├── test-runner.ts              (482 LOC) — 6 test scenarios
├── utils.ts                     (67 LOC) — Cooldown calc, state aggregation
└── api/
    ├── list-areas.ts            (69 LOC)
    ├── area-status.ts           (87 LOC)
    └── configure-area.ts       (106 LOC)
```

## Node-RED Flow Structure

**Presence Subflow** (`173c5faccfb73051`) — 10 instances (one per room):
```
state-changed → debounce → presence.ts → trigger (cooldown delay) → get-flow-info → service call
                                │                                            │
                                └─ publish-presence-state                    └─ influx-logger
```

**Presence 🔦 tab** (`f5468ca00e94e761`):
- Inject → seed-registry (runs once on deploy)
- 3 http-in/function/http-response chains for REST API
- 10-node reset chain (deprecated, scheduled for removal)

## InfluxDB Measurements

- `presence_events` — state transitions, timing, sensor states (tags: topic, room, event_type)
- `get_flow_info_events` — cooldown checks at trigger execution
