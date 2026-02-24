# Plant Automation

Grow light control via time-based scheduling with presence-triggered overrides for shelf lights.

## Architecture

```
┌─────────────────────────────────────────────┐
│           Schedule Engine (1-5min cycle)      │
│                                               │
│  plants_global ─── All grow lights, 6AM-11PM │
│  plants_shelf ──── Shelf lights, 50% window  │
│  bedroom_plants ── Wakeup-Sleep times        │
│  warocqueanum_* ── 5 sub-schedules           │
└────────────────────┬────────────────────────┘
                     │
              ┌──────┴──────┐
              │  Continuous  │
              │  Enforcement │
              └──────────────┘

┌─────────────────────────────────────────────┐
│      Presence Override (bonus room motion)    │
│                                               │
│  Motion on  → setStaticState("on", "plants") │
│             → Immediate turn_on               │
│  10min cool → removeStaticState("plants")    │
│             → Scheduler resumes control       │
└──────────────────────────────────────────────┘
```

## Grow Light Entities

**Shelf** (presence-override controlled):
- `light.pikachu_grow_light`
- `switch.pikachu_grow_light_switch`
- `switch.grow_light_bookshelf_1_switch`

**Bedroom**:
- `switch.master_bedroom_bomb_grow_light`
- `switch.warocqueanum_bedroom_grow_light_switch`
- `switch.master_bedroom_bird_of_paradise_grow_light_switch`
- `switch.master_bedroom_kid_s_theme_grow_light_switch`
- `switch.master_bedroom_pineapple_grow_light_switch`
- `switch.guest_bedroom_grow_light`
- `switch.guest_bedroom_grow_light_2`

**Special**:
- `light.titanic_light` (Warocqueanum)

All matched by global blacklist pattern `/.*grow.*/i` — excluded from presence detection and cache-states.

## Presence Override

When `binary_sensor.bonus_room_motion_sensor_occupancy` fires:
1. `presence-override.ts` sets static states for 3 shelf entities in the `"plants"` namespace
2. Scheduler sees static states → skips those entities
3. After 10-minute cooldown, `remove-override.ts` clears the namespace
4. Scheduler resumes — turns lights on/off based on current schedule window

The override does NOT use the presence DFA. It watches the motion sensor directly.

## HA Helper Entities

| Entity | Purpose |
|--------|---------|
| `input_datetime.plants_global_schedule_start` | Global start (default 06:00) |
| `input_datetime.plants_global_schedule_end` | Global end (default 23:00) |
| `input_boolean.plants_trigger_on` | Manual force-on |
| `input_boolean.plants_trigger_off` | Manual force-off |

## Files

```
src/plants/
├── presence-override.ts    (87 LOC) — Motion → static state → turn_on
├── remove-override.ts      (28 LOC) — Clear static state after cooldown
├── set-static-state.ts     (13 LOC) — Wrapper for setStaticState()
├── set-static-blacklist.ts (13 LOC) — Dynamic entity blacklisting
└── influx-logger.ts        (34 LOC) — plant_events measurement
```

Schedule definitions: `src/scheduling/schedule/schedules/plants-schedules.ts` (136 LOC, 9 schedules)

## Node-RED Flow Tab

**Plants 🌱** (`e921812388e8a474`) — 34 nodes:
- state-changed (motion sensor) → presence-override → switch → turn_on / trigger → remove-override
- state-changed (plants_trigger_on/off) → set-static-state → influx-logger
- filter-blacklisted-entities (3 instances across flows)
