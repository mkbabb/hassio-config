# Presence Detection

Room-level occupancy detection with a 4-state DFA, dynamic cooldown, sensor aggregation, and data-driven area configuration.

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
```

**Critical rule**: `PENDING_OFF` is treated as `OFF` for re-triggering. If motion fires during cooldown, it cancels the pending turn-off and transitions back to `ON`.

## Cooldown Formula

```
coolDown(ms) = min(MAX_COOL_DOWN, baseCoolDown + min(dwellMinutes, 60) × 10) × 1000
```

- Base: 10 minutes (600s)
- Maximum: 20 minutes (1200s)
- Longer occupancy = longer hysteresis (linear ramp, capped at 60min dwell)
- Examples: 5min dwell → base + 50s, 30min → base + 300s, 60min+ → base + 600s

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

Per-room state is stored in global context as `global.get("presenceFlowInfo.{topic}")` and `global.get("presenceStates.{topic}")`, making it accessible from API endpoints on any tab.

## REST API

| Method | Path | Handler |
|--------|------|---------|
| GET | `/presence/` | list-areas.ts — All areas with runtime state |
| GET | `/presence/:topic/status` | area-status.ts — Full flow state for one area |
| POST | `/presence/` | configure-area.ts — Create/update area config |
| POST | `/presence/:topic/clear-cooldown` | clear-cooldown.ts — Reset cooldown for one area |
| POST | `/presence/clear-all-cooldowns` | clear-all-cooldowns.ts — Reset all active cooldowns |

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
├── types.ts                     — PresenceAreaConfig, PresenceRegistry
├── utils.ts                     — Cooldown calc, state aggregation
├── presence.ts                  — Core DFA state machine
├── debounce.ts                  — 1s input / 30s reset debounce
├── get-flow-info.ts             — Cooldown check at trigger time
├── get-flow-info-logger.ts      — get_flow_info_events logging
├── influx-logger.ts             — presence_events logging
├── seed-registry.ts             — 9 area definitions + blacklist
├── publish-presence-state.ts    — Sensor publishing with dedup
├── startup-reconcile.ts         — DFA initialization on restart
├── cooldown-ticker.ts           — Dashboard cooldown progress updates
├── condition-enforcer.ts        — Condition gating on day/night changes
├── test-runner.ts               — 6 test scenarios
└── api/
    ├── list-areas.ts            — GET /endpoint/presence/
    ├── area-status.ts           — GET /endpoint/presence/:topic/status
    ├── configure-area.ts        — POST /endpoint/presence/
    ├── clear-cooldown.ts        — POST /endpoint/presence/:topic/clear-cooldown
    └── clear-all-cooldowns.ts   — POST /endpoint/presence/clear-all-cooldowns
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
