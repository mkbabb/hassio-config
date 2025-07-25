# Node-RED Function Node to TypeScript Mappings

## Analysis Summary

- **Total Function Nodes**: 29 identified in flows
- **Successfully Mapped**: 28 nodes (96.5%)
- **Analysis Date**: 2025-07-25

## Key Identification Methods

### 1. Explicit Comments
Many compiled functions preserve source file comments:
```javascript
// src/presence/get-flow-info.ts
// src/batteries/battery.ts
// src/chronos/guest-daytime.ts
```

### 2. Unique Constants
Functions can be identified by their unique constants:
- **Presence**: `MAX_COOL_DOWN = 30 * 60`, `DEFAULT_COOL_DOWN = 10 * 60`
- **Battery**: `LOW_BATTERY_THRESHOLD = 30`, `CRITICAL_BATTERY_THRESHOLD = 15`
- **Home Status**: `STABLE_PERIOD_MS = 5 * 60 * 1e3`
- **Time of Use**: `PRECOOL_TIME = 2 * 60 * 60 * 1000`

### 3. Function Signatures
Utility functions from `utils.ts` appear frequently:
- `getEntityDomain(entityId)`
- `getEntityBasename(entityId)`
- `normalizeIncludes(s1, s2)`
- `deepEqual(a, b)`
- `mapRange(value, fromMin, fromMax, toMin, toMax)`

### 4. Flow Variable Patterns
Different modules use distinct flow variables:
- **Presence**: `presenceStates.${topic}`, `flowInfo.${topic}`
- **Plants**: `staticPlantStates`, `cachedTimes`
- **Home Status**: `home_status_last_state`

## Definitive Mappings

### Cache States Module
| Node ID | Node Name | Source File |
|---------|-----------|-------------|
| `5cd5c7a97cbfb2a5` | states to actions | `cache-states/states-to-actions.ts` |
| `fd875b9553cf1720` | cache house state | `cache-states/cache-house-state.ts` |
| `627b25edecfe582e` | filter blacklisted entities | `cache-states/filter-blacklisted-entities.ts` |
| `c04368f701cd604d` | action node | `cache-states/action-node.ts` |
| `3f3963cff3716131` | push cached states | `cache-states/push-cache-states.ts` |
| `20d9cf93f238d30f` | home status | `cache-states/home-status.ts` |
| `fcef4072b3d808c5` | merge cached states | `cache-states/merge-cached-states.ts` |
| `57ba98e05115a206` | merge scene cached states | `cache-states/merge-scene-cached-states.ts` |

### Presence Module
| Node ID | Node Name | Source File |
|---------|-----------|-------------|
| `f633b8e8b3205bc1` | presence | `presence/presence.ts` |
| `f59de909516cb178` | get flow info | `presence/get-flow-info.ts` |

### Battery Module
| Node ID | Node Name | Source File |
|---------|-----------|-------------|
| `9b723d99a73d643f` | battery | `batteries/battery.ts` |

### Get Domain Entities Module
| Node ID | Node Name | Source File |
|---------|-----------|-------------|
| `420bdf56a9545130` | filter hidden entities and domains | `get-domain-entities/filter-hidden-and-domains.ts` |
| `f3f79edb0a0bc587` | reconcile entities | `get-domain-entities/reconcile.ts` |
| `fe549fb394a9227a` | filter entities | `get-domain-entities/filter-entites.ts` |

### Chronos Module
| Node ID | Node Name | Source File |
|---------|-----------|-------------|
| `872a4dcbed026511` | create schedule cron | `chronos/cron.ts` |
| `8707143d8533922c` | inside preamble window | `chronos/inside-preamble-window.ts` |
| `b2b315489cc8d2a7` | guest daytime | `chronos/guest-daytime.ts` |

### Plants Module
| Node ID | Node Name | Source File |
|---------|-----------|-------------|
| `d22ac4c1c222afd5` | cache schedule entity | `plants/cache-schedule-entity.ts` |
| `6bc7f26c9c624e6c` | pop schedule entity cache | `plants/pop-schedule-entity-cache.ts` |
| `8baf517e98f7f1a1` | schedule | `plants/schedule.ts` |
| `2f73425d194d82fa` | schedules | `plants/schedules.ts` |
| `04f8709ebd6588c0` | set static state | `plants/set-static-state.ts` |

### Remote Entities Module
| Node ID | Node Name | Source File |
|---------|-----------|-------------|
| `e2cb1e6a7e2044f7` | get entity attributes id | `remote-entities/get-entity-attributes-id.ts` |
| `ba17a7bee754d74a` | create service call | `remote-entities/service-call/main.ts` |

### Time of Use Module
| Node ID | Node Name | Source File |
|---------|-----------|-------------|
| `8f4c1ad0cad49211` | function | `time-of-use.ts` |

## Duplicate Nodes

Several nodes appear to be duplicates with identical compiled code:
- `715a229a5e312dca` = `3f3963cff3716131` (push cached states)
- `08f84c6d37343c7a` = `627b25edecfe582e` (filter blacklisted entities)
- `76883f7cb338fb52` = `872a4dcbed026511` (create schedule cron)
- `3cbb13d1da946813` = `627b25edecfe582e` (filter blacklisted entities)

## Compilation Patterns

### Build Process Indicators
1. **"use strict" directive**: Added by the build process to most functions
2. **Import compilation**: Import statements are compiled into the function body
3. **Return statement**: Build process appends `return msg;` to functions
4. **Comment preservation**: Some source file paths are preserved as comments

### Code Structure
The TypeScript files follow a consistent pattern:
1. Import utilities from `../utils/utils`
2. Define constants
3. Access Node-RED message via `msg` variable
4. Manipulate flow/global context
5. Export modified message

## Blacklisted Entities

The system maintains a consistent blacklist across multiple functions:
```javascript
const BLACKLISTED_ENTITIES = [
    "son_of_toast",              // car
    /.*grow.*/i,                 // grow lights
    /.*blinds.*/i,               // blinds
    /.*air_purifier.*/i,         // air purifiers
    /switch.ratgdov25i_4b1c3b.*/, // garage door
    "lock.ratgdov25i_4b1c3b_lock_remotes",
    /.*sonos_beam.*/i,           // sonos
    "washer_power",              // washer
    "dryer_power",               // dryer
    "switch.plant_water_pump_switch",
    /espresense_.*/i             // ESPresence
]
```

## Unknown Functions

Only one function could not be definitively mapped:
- `55653f952629f321` ("function 1"): Appears to be an inline transformation function for RGB colors and brightness, not sourced from TypeScript files.