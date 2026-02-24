# Node-RED Flow Architecture

13 flow tabs, 8 subflow definitions, 485 total nodes. All TypeScript logic compiled to IIFE bundles deployed as function node code.

## Flow Tabs

| Tab | ID | Nodes | Purpose |
|-----|----|-------|---------|
| Cache Home 🏡 | `4f871e90.29a61` | 54 | Entity snapshots, away mode, cache publishing |
| Is Home 🔍 | — | 24 | Multi-sensor home/away determination |
| Scheduler ⏳ | `test_scheduler_1753565985859` | 36 | Schedule engine + REST API (6 endpoints) |
| Day 🌞/Night 🌚 | `a807a4834abd67fa` | 88 | Day/night transitions, state merging |
| Thermostat Time of Use | — | 26 | Energy optimization (DISABLED) |
| Plants 🌱 | `e921812388e8a474` | 34 | Grow lights + presence override |
| Presence 🔦 | `f5468ca00e94e761` | 107 | Presence API + seed-registry + reset chain |
| Bathroom Fans 🚽 | — | 7 | Exhaust fan automation |
| Batteries 🔋 | `e05fae85092ccf96` | 15 | Battery monitoring |
| Piano 🎹 | — | 15 | Entertainment room |
| Remote Entities 🪤 | `6337f535d7b8e1f2` | 18 | IR/RF abstraction |
| Garage 🚗 | `garage_door_flow_tab` | 12 | Tesla-triggered garage |
| Scene Rollback | `scene_rollback_flow_tab` | 18 | Push/pop state stack |

## Subflows

| Subflow | Instances | Purpose |
|---------|-----------|---------|
| Presence Subflow | 10 | Per-room DFA with cooldown |
| Get Area Entities | 7 | Entity fetch by area/floor |
| Force Set State | 2 | HA entity state override |
| Cache House States Away | 1 | Full entity snapshot |
| Get Domain Entities | 1 | Domain-filtered entity fetch |
| Set Unavailable | 1 | Entity unavailable marker |
| Set Null User | 1 | User context clearing |
| Action Node with Check | 1 | Smart action filter |

## TypeScript → Node Mapping (48 total)

Each TypeScript file maps to one or more function nodes via `node-mappings.json`. The build system uses MD5 hashing to match compiled JS to function node code.

### Scheduler ⏳
- `schedules/index.ts` → "schedules" (registry seeding)
- `schedule/index.ts` → "schedule" (engine)
- `simulate-sun.ts` → "simulate sun"
- `influx-logger.ts` → "Log Schedule"
- `publish-schedule-state.ts` → "publish schedule state"
- `api/list-schedules.ts` → "list schedules"
- `api/get-schedule.ts` → "get schedule"
- `api/create-schedule.ts` → "create schedule"
- `api/update-schedule.ts` → "update schedule"
- `api/delete-schedule.ts` → "delete schedule"
- `api/schedule-status.ts` → "schedule status"

### Presence Subflow
- `presence.ts` → "presence"
- `get-flow-info.ts` → "get flow info"
- `influx-logger.ts` → "Format for InfluxDB"
- `publish-presence-state.ts` → "publish presence state"

### Presence 🔦
- `seed-registry.ts` → "seed presence registry"
- `api/list-areas.ts` → "list areas"
- `api/area-status.ts` → "area status"
- `api/configure-area.ts` → "configure area"

### Cache Home 🏡
- `home-status.ts` → "home status"
- `push-cache-states.ts` → "push cache states" (2 instances)
- `filter-blacklisted-entities.ts` → "filter blacklisted entities"
- `publish-cache-state.ts` → "publish cache state"

### Day 🌞/Night 🌚
- `merge-cached-states.ts` → "merge cached states"
- `merge-scene-cached-states.ts` → "merge scene cached states"
- `cache-schedule-entity.ts` → "cache schedule entity"
- `pop-schedule-entites.ts` → "pop schedule entites"

### Scene Rollback
- `rollback-push.ts` → "rollback push"
- `rollback-pop.ts` → "rollback pop"
- `rollback-influx-logger.ts` → "Log Rollback Push", "Log Rollback Pop"

## Publisher Chain Pattern

All state publishers follow the same downstream chain:

```
function node (build sensor array)
    │
    ▼
switch (msg.payload !== null)
    │
    ▼
split (array → individual messages)
    │
    ▼
ha-api (POST /api/states/{{payload.entity_id}})
    server: 79544c2b.6ccc64
    data: payload (jsonata)
```

## Server Configuration

- **HA Server ID**: `79544c2b.6ccc64`
- **httpNodeRoot**: `/endpoint/` (auto-prepended to all http-in URLs)
- **Node Versions**: state-changed v6, api-call-service v7, api-current-state v3

## Inter-Flow Dependencies

```
Is Home 🔍 ───────────────► Cache Home 🏡 ───────► Day 🌞/Night 🌚
     │                            ▲                       │
     │                            │                       │
     │                     Scene Rollback                  ▼
     │                                               Plants 🌱
     │
     └──► Presence 🔦 ────► Presence Subflow (×10)
                                    │
                              Scheduler ⏳
```
