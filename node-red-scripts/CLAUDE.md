# Node-RED TypeScript Automation

**80+ TypeScript modules | ~10K LOC | 48 deploy mappings**

Production-grade Home Assistant automation framework with incremental compilation, dependency tracking, and hot-reload deployment.

## Architecture

```
src/
├── presence/                       # 13 files, 1827 LOC
│   ├── presence.ts (360 LOC)      # Core DFA state machine
│   ├── types.ts                    # PresenceAreaConfig, PresenceRegistry
│   ├── utils.ts                    # Cooldown calc, state aggregation
│   ├── debounce.ts                 # 1s input / 30s reset debounce
│   ├── get-flow-info.ts            # Cooldown check at trigger time
│   ├── get-flow-info-logger.ts     # get_flow_info_events logging
│   ├── influx-logger.ts            # presence_events logging
│   ├── seed-registry.ts            # 9 area definitions + blacklist
│   ├── publish-presence-state.ts   # HA sensor publishing
│   ├── test-runner.ts              # 6 test scenarios
│   └── api/
│       ├── list-areas.ts           # GET /endpoint/presence/
│       ├── area-status.ts          # GET /endpoint/presence/:topic/status
│       └── configure-area.ts       # POST /endpoint/presence/
│
├── scheduling/                     # 24 files, ~2900 LOC
│   ├── types.ts                    # Schedule, RegistrySchedule, ScheduleRegistry
│   ├── schedule/
│   │   ├── index.ts (497 LOC)     # Main engine
│   │   ├── conditions.ts          # Presence/state condition checks
│   │   ├── entity-matching.ts     # Regex/tag/exact matching
│   │   ├── schedule-processing.ts # Continuous vs trigger logic
│   │   ├── state-mapping.ts       # Domain→state→service
│   │   └── schedules/
│   │       ├── index.ts           # Registry seeding
│   │       ├── plants-schedules.ts
│   │       ├── day-night-schedules.ts
│   │       ├── blinds-schedules.ts
│   │       └── lock-schedules.ts
│   ├── api/
│   │   ├── registry.ts            # CRUD utilities
│   │   ├── validation.ts          # Schema validation
│   │   ├── list-schedules.ts      # GET /endpoint/schedules/
│   │   ├── get-schedule.ts        # GET /endpoint/schedules/:name
│   │   ├── create-schedule.ts     # POST /endpoint/schedules/
│   │   ├── update-schedule.ts     # PUT /endpoint/schedules/:name
│   │   ├── delete-schedule.ts     # DELETE /endpoint/schedules/:name
│   │   └── schedule-status.ts     # GET /endpoint/schedule-status
│   ├── publish-schedule-state.ts  # HA sensor publishing with dedup
│   ├── simulate-sun.ts            # Brightness/color interpolation
│   ├── cache-schedule-entity.ts   # input_datetime caching
│   ├── pop-schedule-entites.ts    # Cached time retrieval
│   └── influx-logger.ts           # schedule_events logging
│
├── cache-states/                   # 14 files, 978 LOC
│   ├── cache-house-state.ts       # Snapshot + away payload (presence split)
│   ├── home-status.ts             # 5min/30s debouncer
│   ├── filter-blacklisted-entities.ts
│   ├── merge-cached-states.ts     # Merge with presence filter
│   ├── merge-scene-cached-states.ts
│   ├── push-cache-states.ts
│   ├── states-to-actions.ts
│   ├── action-node.ts             # Smart action filter
│   ├── publish-cache-state.ts     # HA sensor publishing
│   ├── rollback-push.ts           # Scene capture (HTTP POST)
│   ├── rollback-pop.ts            # Scene undo (input_boolean)
│   ├── rollback-influx-logger.ts
│   ├── influx-logger.ts
│   └── utils.ts                   # createServiceCall, createAwayPayload
│
├── plants/                         # 5 files, 175 LOC
│   ├── presence-override.ts       # Motion → static state → turn_on
│   ├── remove-override.ts         # Clear after cooldown
│   ├── set-static-state.ts
│   ├── set-static-blacklist.ts
│   └── influx-logger.ts
│
├── remote-entities/                # IR/RF abstraction
│   ├── service-call/index.ts      # Dispatch (light/fan)
│   ├── get-entity-attributes-id.ts
│   └── influx-logger.ts
│
├── batteries/                      # Battery monitoring
│   ├── battery.ts
│   └── influx-logger.ts
│
├── utils/                          # Shared utilities
│   ├── entities.ts                # HA entity API (5s TTL cache)
│   ├── datetime.ts                # Time manipulation
│   ├── service-calls.ts           # Domain→service mapping
│   ├── influx-logger-base.ts      # Type-safe InfluxDB conversion
│   ├── static-states.ts           # Namespace-aware state/blacklist
│   └── utils.ts                   # General helpers
│
└── types/
    ├── hass.d.ts                   # Hass.State, Hass.Service, Hass.Action
    └── influx-messages.d.ts        # Per-flow message type definitions
```

## Core Modules

### Presence Detection (`src/presence/`)

**Purpose**: Room-level occupancy with dynamic cooldown, data-driven registry, REST API, and sensor publishing.

**Full documentation**: `docs/PRESENCE.md`

**State Machine**:
```
OFF ──motion──> ON ──no motion──> PENDING_OFF ──expires──> OFF
                 ↑                      │
                 └──────motion──────────┘
```

**Files** (13 total, 1827 LOC):
- `presence.ts` (360 LOC) - Core DFA, sensor aggregation, action grouping
- `utils.ts` (67 LOC) - `calculateCoolDown()`, `determinePresenceState()`
- `debounce.ts` (48 LOC) - 1s input / 30s reset debounce
- `get-flow-info.ts` (63 LOC) - Cooldown checks at trigger execution
- `get-flow-info-logger.ts` (88 LOC) - `get_flow_info_events` logging
- `influx-logger.ts` (130 LOC) - `presence_events` logging
- `seed-registry.ts` (179 LOC) - 9 area definitions + namespace blacklist
- `publish-presence-state.ts` (119 LOC) - HA sensor publishing with dedup
- `test-runner.ts` (482 LOC) - 6 test scenarios
- `types.ts` (29 LOC) - PresenceAreaConfig, PresenceRegistry
- `api/list-areas.ts` (69 LOC) - GET /endpoint/presence/
- `api/area-status.ts` (87 LOC) - GET /endpoint/presence/:topic/status
- `api/configure-area.ts` (106 LOC) - POST /endpoint/presence/

**Registry**: `global.get("presenceRegistry")` — 9 areas, each with sensors, entities, cooldown config. Presence-tracked entities registered in `"presence"` namespace blacklist.

**Published Sensors**: `sensor.presence_{topic}_state`, `sensor.presence_{topic}_cooldown`

**Critical**: Treat `pending_off` as `off` for re-triggering (`wasPendingOffTreatedAsOff` flag)

### Scheduling Engine (`src/scheduling/`)

**Purpose**: Registry-based scheduling with continuous/trigger modes, REST CRUD API, and sensor publishing.

**Full documentation**: `docs/SCHEDULING.md` | **API**: `docs/API.md`

**Files** (24 total, ~2900 LOC):
- `schedule/index.ts` (497 LOC) - Main engine: entity matching, precedence, actions
- `schedule/schedules/*.ts` (4 files, ~240 LOC) - Static schedule definitions
- `schedule/conditions.ts` (43 LOC) - Presence/state condition checks
- `schedule/entity-matching.ts` (154 LOC) - Regex/tag/exact matching
- `schedule/schedule-processing.ts` (93 LOC) - Continuous vs trigger logic
- `schedule/state-mapping.ts` (142 LOC) - Domain→state→service resolution
- `api/*.ts` (8 files, ~800 LOC) - REST CRUD + status endpoints
- `publish-schedule-state.ts` (214 LOC) - HA sensor publishing with dedup
- `simulate-sun.ts` (304 LOC) - Brightness/color temp interpolation
- `types.ts` (112 LOC) - Schedule, RegistrySchedule, ScheduleRegistry

**Registry**: `global.get("scheduleRegistry")` — 13 static schedules, seeded on startup, dynamic schedules via POST API. Static schedules cannot be deleted (only disabled).

**Schedule Types**:
- **Continuous**: Enforce state throughout active window (plants, climate)
- **Trigger**: Fire once at start/end with ±10min window (blinds, locks)

**REST API**: 6 endpoints — CRUD at `/endpoint/schedules/` + `/endpoint/schedule-status`

**Published Sensors**: `sensor.schedule_{name}_status`, `sensor.schedule_{name}_progress`, `sensor.active_schedule_count`, `sensor.schedule_engine_last_run`

**Key Concepts**:
- Precedence: higher number wins when multiple schedules match same entity
- `durationModifier`: Centered window shrink (0.5 = 50% of parent window)
- Interpolation: Preamble/postamble phases with `t` value 0→1 for ramp simulation

### Cache States & Rollback (`src/cache-states/`)

**Purpose**: Scene snapshots with away-mode conversion, scene rollback stack, and presence-aware filtering.

**Full documentation**: `docs/CACHE-STATES.md`

**Files** (14 total, 978 LOC):
- `cache-house-state.ts` (46 LOC) - Snapshot + away payload (presence split)
- `states-to-actions.ts` (9 LOC) - Service call → action format
- `merge-cached-states.ts` (26 LOC) - Merge with presence filter
- `merge-scene-cached-states.ts` (36 LOC) - Scene state merge with filter
- `filter-blacklisted-entities.ts` (27 LOC) - Global + namespace filtering
- `home-status.ts` (104 LOC) - 5min/30s debouncer
- `publish-cache-state.ts` (90 LOC) - Sensor publishing
- `push-cache-states.ts` (30 LOC) - Push to global store
- `rollback-push.ts` (99 LOC) - Pre-scene capture (POST /endpoint/scene-cache/)
- `rollback-pop.ts` (80 LOC) - Scene undo (input_boolean trigger)
- `rollback-influx-logger.ts` (36 LOC) - rollback_events logging
- `action-node.ts` (105 LOC) - Smart action filter (skip unchanged)
- `influx-logger.ts` (53 LOC) - cache_events logging
- `utils.ts` (237 LOC) - createServiceCall, createAwayPayload, filterAttributes

**Presence Filtering**: 5 files exclude presence-tracked entities via `shouldFilterEntity(entityId, { namespace: "presence" })`. Away payload still turns off presence lights; home restore does NOT restore them.

**Published Sensors**: `sensor.cache_state_status`, `sensor.cache_state_last_operation`, `sensor.scene_rollback_status`

### Remote Entities (`src/remote-entities/`)

**Purpose**: IR/RF device abstraction (Dyson fans, monitor lights)

**Dispatch Pattern**:
```typescript
// service-call/index.ts
switch (serviceDomain) {
  case "light": return light.createServiceCall(payload);
  case "fan": return fan.createServiceCall(payload);
}
```

**Implementations**:
- `light.ts` - Brightness (0-100) + color temp (2700K-6500K) mapping
- `fan.ts` - Fan speed via IR
- `influx-logger.ts` - Remote command tracking (`remote_events`)

### Batteries (`src/batteries/`)

**Purpose**: Battery level monitoring

**Thresholds**:
- Low: < 30%
- Critical: < 15%

**Output**: Sorted notifications (lowest battery first)

**Measurement**: `battery_events` (InfluxDB)

### Utilities (`src/utils/`)

**Core Modules**:

1. **entities.ts** - Home Assistant entity API
   ```typescript
   getAllEntities() → Record<string, Hass.State>  // 5s TTL cache
   getEntity(entityId) → Hass.State | null
   getEntitiesByDomain(domain) → Hass.State[]
   getEntitiesByPattern(pattern: RegExp) → Hass.State[]
   getBatteryLevel(entity) → number | null
   ```

2. **datetime.ts** - Time manipulation
   ```typescript
   compareTime(t1, t2, withDay?) → -1 | 0 | 1
   isTimeInRange(current, start, end) → boolean
   handleMidnightSpan(start, end, now) → [Date, Date]
   calculateScheduleTimes(startStr, endStr, now) → { start, end }
   getPythonWeekday(date) → number  // 0=Mon (Python compatible)
   ```

3. **service-calls.ts** - Domain→Service mapping
   ```typescript
   DOMAIN_STATES = {
     light: { on: "on", off: "off" },
     lock: { on: "locked", off: "unlocked" },
     cover: { on: "open", off: "closed" },
     // ... 22 domains
   }

   domainToService(entity, domain) → string
   serviceToActionCall(call) → Hass.Action  // Converts to modern format
   groupActions(actions) → Hass.Action[]    // Consolidate entity_ids
   ```

4. **influx-logger-base.ts** - Type-safe InfluxDB conversion
   ```typescript
   safeNumber(value) → number            // Handle any → number
   safeString(value) → string            // Null-safe string conversion
   safeBooleanAsInt(value) → 0 | 1       // InfluxDB boolean format
   sanitizeFields(fields) → Record       // Auto-detect and convert
   createLogEvent(measurement, fields, tags) → LogEvent
   ```

5. **static-states.ts** - Namespace-aware state overrides
   ```typescript
   setStaticState(entityId, state, namespace)
   getStaticStates(namespace) → Record<string, string>
   addToBlacklist(entityId, namespace)
   shouldFilterEntity(entityId, options) → boolean
   ```

6. **utils.ts** - General utilities
   ```typescript
   getEntityBasename(entity) → string    // "front_door" from "lock.front_door"
   getEntityDomain(entity) → string      // "lock" from "lock.front_door"
   deepEqual(a, b) → boolean
   withTTL(key, ttlMs, fetcher) → T      // TTL caching pattern
   ```

## InfluxDB Measurements

| Measurement | Flow | Key Fields | Tags |
|-------------|------|------------|------|
| `presence_events` | Presence | presence_state, cool_down_seconds, sensor_states | topic, room, event_type |
| `get_flow_info_events` | Presence | flow_state, cooldown_remaining_ms, action | topic, state, action |
| `cache_events` | Cache | operation, state, entity_count, cache_size | event_type, operation |
| `schedule_events` | Scheduling | schedule_name, precedence, active_schedules | schedule_name, entity_domain |
| `plant_events` | Plants | schedule_active, current_state, schedule_name | entity_id, schedule_name |
| `battery_events` | Batteries | battery_level, is_low, is_critical | entity_id, status |
| `remote_events` | Remote | command_count, state_transition | entity_id, device_type |
| `garage_door_events` | Garage | action_numeric, suppression_reason | trigger_type, suppression_status |

**Data Type Rules**:
- Booleans → `safeBooleanAsInt()` (0/1)
- Objects → JSON strings (truncated to 1000 chars) or counts
- Strings → `safeString()` (null-safe)
- Numbers → `safeNumber()` (handles null/undefined)

## Type Definitions (`src/types/`)

### hass.d.ts

```typescript
namespace Hass {
  interface State {
    entity_id: string
    state: string
    attributes: Partial<Attribute>
    last_changed: string
    timeSinceChangedMs: number
  }

  interface Service {
    domain: string
    service: string
    entity_id?: string
    data?: Record<string, any>
  }

  interface Action {
    action: string                    // "domain.service"
    data: Record<string, any>
    target: { entity_id?, device_id?, area_id? }
  }

  namespace Attributes {
    interface Light { brightness?, color_temp?, effect?, color_mode? }
    interface Climate { temperature?, preset_mode?, hvac_mode? }
    // ... per-domain attribute definitions
  }
}
```

### influx-messages.d.ts

```typescript
interface PresenceMessage extends BaseMessage {
  presenceState?: string
  aggregateState?: string
  inCoolDown?: boolean
  debug?: PresenceDebugInfo
}

interface ScheduleMessage extends BaseMessage {
  schedule?: { name, type, precedence }
  entity?: { entity_id, state }
  debug?: ScheduleDebugInfo
}

// 8 flow-specific message types
```

## Build System (See: build/CLAUDE.md)

**Compiler**: esbuild with custom TypeScript orchestrator
**Output**: IIFE bundles with `return msg;` footer for Node-RED compatibility

**Key Features**:
- Incremental compilation (24h cache staleness)
- Dependency graph (forward + reverse)
- MD5-based change detection
- Watch mode with auto-rebuild
- CommonJS artifact removal

**Commands**:
```bash
npm run build            # Incremental build
npm run watch            # Watch mode
npm run build:deploy     # Build + deploy
npm run clean            # Delete dist/
```

## Deployment System (See: build/CLAUDE.md)

**Strategy**: Hash-based function mapping with AI reconciliation fallback

**Deployment Modes**:
1. **API** (default): Hot reload via Node-RED Admin API (no restart)
2. **File**: Direct flows.json modification + addon restart

**Mapping Confidence Levels**:
- `exact` - Single MD5 hash match
- `high` - Hash collision resolved by name similarity
- `ai-reconciled` - GPT-5 semantic matching (75%+ confidence)
- `orphaned` - Compiled JS exists but source missing

**Commands**:
```bash
npm run map              # Hash-based mapping
npm run map -- --ai      # With AI reconciliation

npm run deploy -- src/presence/presence.ts
npm run deploy:all
npm run deploy -- --dry-run
npm run deploy -- --rename-only
```

**Backup System**:
- Auto-backup before each deployment
- Timestamped: `flows_YYYY-MM-DDTHH-mm-ss-SSSZ.json`
- Retention: 10 most recent

**Mapping Stats** (current):
```json
{
  "total": 48,
  "exact": 48,
  "unmapped": 1
}
```

## Node-RED Standards

**Server Configuration**:
- **HA Server ID**: `79544c2b.6ccc64` (use for all nodes)
- **Node Versions**: state-changed v6, api-call-service v7, api-current-state v3

**Naming Convention**:
```
Lowercase descriptive format:
  ✓ "state_changed: input_boolean.plants_trigger_on"
  ✓ "turn off plants_trigger_on"
  ✗ "Turn Off Plants Trigger On" (avoid title case)
```

**Positioning**:
```
x=680   - State/trigger nodes (leftmost)
x=1180  - Current state nodes (middle)
x=1610  - Service call nodes (rightmost)
y spacing: 200px between chains
```

**Entity Configuration**:
```yaml
# CORRECT (current standard)
entities:
  entity: ["light.example"]
  substring: []
  regex: []

# DEPRECATED
entityidfilter: "light.example"
```

## Global Blacklist

```typescript
[
  "son_of_toast",              // Tesla vehicle
  /.*grow.*/i,                 // Grow lights (excluded from presence/cache)
  /.*blinds.*/i,               // Window covers
  /.*air_purifier.*/i,         // Air quality devices
  "switch.washing_machine",
  "switch.dryer",
  /espresense_.*/i,            // Presence sensors
  /.*sonos_beam.*/i            // Speakers
]
```

## Development Workflow

### Standard Loop
```bash
# 1. Edit TypeScript
vim src/presence/presence.ts

# 2. Build
npm run build

# 3. Deploy to Node-RED
npm run deploy -- src/presence/presence.ts

# Or use watch mode (Terminal 1)
npm run watch
```

### Initial Setup
```bash
# 1. Generate mappings
npm run map              # Hash-based
npm run map -- --ai      # With AI (requires OPENAI_API_KEY)

# 2. Configure .env
cat > .env <<EOF
NODE_RED_URL=http://homeassistant.local:1880
NODE_RED_FLOWS_PATH=/Volumes/addon_configs/a0d7b954_nodered/flows.json
HA_USERNAME=your-user
HA_PASSWORD=your-pass
HA_TOKEN=your-ha-token
OPENAI_API_KEY=sk-...
EOF

# 3. Deploy
npm run deploy:all
```

### Debugging
```bash
# View build cache
cat .build-cache.json

# Check mappings
cat build/deploy/mappings/node-mappings.json

# List backups
ls -la backups/

# Build with debug output
npm run build -- --debug
```

## Critical Design Notes

### Presence Detection
- **PENDING_OFF as OFF**: Critical for re-triggering during cooldown
- **Flow State Persistence**: Survives deployments, resets on service restart
- **Debounce Levels**: Input (1s), Reset (30s)
- **History Tracking**: Last 3 states (`state`, `prevState`, `prevPrevState`)

### Scheduling
- **Precedence**: Higher number = higher priority
- **Continuous**: Always enforces state during active window
- **Trigger**: Fires once at start/end (±10min window)
- **Midnight Crossing**: If end < start, adds 1 day to end time

### InfluxDB Logging
- **Boolean Format**: Always use `safeBooleanAsInt()` (0/1)
- **Object Handling**: Convert to counts or JSON strings
- **String Safety**: Use `safeString()` for null/undefined
- **Sanitization**: Auto-detects field types, filters null values

### Static States & Namespaces
- **Namespaces**: `plants` (grow light overrides), `presence` (presence-tracked entities), `default`
- **Override Priority**: Static state > schedule > default
- **Blacklist**: Global (regex patterns) + per-namespace (entity IDs)
- `shouldFilterEntity(entityId, { namespace })` — checks both levels

## Performance Optimizations

- **Entity Caching**: 5s TTL for `getAllEntities()`
- **Direct Access**: `getEntity()` bypasses cache for single lookups
- **Action Grouping**: Consolidates multiple entity_ids → single API call
- **Incremental Builds**: MD5-based change detection, dependency graph
- **esbuild Contexts**: Reused across successive builds (2-3x speedup)

## File Paths

| Path | Purpose |
|------|---------|
| `/Volumes/config/node-red-scripts/src/` | TypeScript source (60 files) |
| `/Volumes/config/node-red-scripts/dist/` | Compiled JavaScript (37 files) |
| `/Volumes/config/node-red-scripts/build/` | Build system |
| `/Volumes/config/node-red-scripts/.build-cache.json` | Build cache (24h staleness) |
| `/Volumes/config/node-red-scripts/backups/` | Flow backups (10 most recent) |
| `/Volumes/addon_configs/a0d7b954_nodered/flows.json` | Node-RED flows |

## Dependencies

```json
{
  "typescript": "5.9.3",
  "esbuild": "0.25.11",
  "tsx": "^4.19.2",
  "axios": "^1.7.9",
  "yargs": "^17.7.2",
  "openai": "^4.73.1",
  "chalk": "^4.1.2",
  "chokidar": "^4.0.3"
}
```

---

**Last Updated**: 2026-02-23
**Total LOC**: ~10,000 (TypeScript)
**Modules**: 80+ source files, 48 deploy mappings
**Deployment**: File-based + addon restart (API hot-reload returns 400)
**System Docs**: See `docs/` directory for detailed subsystem documentation
