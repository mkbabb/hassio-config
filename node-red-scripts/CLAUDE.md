# Node-RED TypeScript Automation

**60 TypeScript modules | 7693 LOC | 37 compiled outputs**

Production-grade Home Assistant automation framework with incremental compilation, dependency tracking, and hot-reload deployment.

## Architecture

```
src/                           dist/
├── presence/                  ├── presence/
│   ├── presence.ts (11.6KB)  │   ├── presence.js
│   ├── utils.ts              │   ├── utils.js
│   ├── debounce.ts           │   ├── debounce.js
│   ├── get-flow-info.ts      │   ├── get-flow-info.js
│   ├── influx-logger.ts      │   └── influx-logger.js
│   └── test-runner.ts        │
├── scheduling/                ├── scheduling/
│   ├── schedule/              │   └── schedule/
│   │   ├── index.ts (16KB)   │       ├── index.js
│   │   ├── schedules/         │       └── schedules/
│   │   │   ├── plants-schedules.ts
│   │   │   ├── day-night-schedules.ts
│   │   │   └── blinds-schedules.ts
│   ├── cache-schedule-entity.ts
│   └── types.ts              │
├── plants/                    ├── plants/
│   ├── set-static-state.ts   │   ├── set-static-state.js
│   └── influx-logger.ts      │   └── influx-logger.js
├── cache-states/              ├── cache-states/
│   ├── cache-house-state.ts  │   ├── cache-house-state.js
│   ├── states-to-actions.ts  │   ├── states-to-actions.js
│   └── utils.ts              │   └── utils.js
├── remote-entities/           ├── remote-entities/
│   └── service-call/          │   └── service-call/
│       ├── light.ts          │       ├── light.js
│       └── fan.ts            │       └── fan.js
├── batteries/                 ├── batteries/
│   ├── battery.ts            │   ├── battery.js
│   └── influx-logger.ts      │   └── influx-logger.js
├── utils/                     ├── utils/
│   ├── entities.ts           │   ├── entities.ts
│   ├── datetime.ts           │   ├── datetime.js
│   ├── service-calls.ts      │   ├── service-calls.js
│   ├── influx-logger-base.ts │   ├── influx-logger-base.js
│   └── static-states.ts      │   └── static-states.js
└── types/
    ├── hass.d.ts
    └── influx-messages.d.ts
```

## Core Modules

### Presence Detection (`src/presence/`)

**Purpose**: Room-level occupancy with dynamic cooldown

**State Machine**:
```
OFF ──motion──> ON ──no motion──> PENDING_OFF ──expires──> OFF
                 ↑                      │
                 └──────motion──────────┘
```

**Files**:
- `presence.ts` (11.6KB) - Main state machine, sensor aggregation, action grouping
- `utils.ts` - `calculateCoolDown()`, `determinePresenceState()`, `isOnUnknownOffSequence()`
- `debounce.ts` - 1s debounce window for rapid state changes
- `get-flow-info.ts` - Cooldown status checks at trigger execution
- `influx-logger.ts` - `presence_events` measurement logging
- `test-runner.ts` - Unit tests for state machine logic

**Key Constants**:
```typescript
DEFAULT_COOL_DOWN = 10 * 60      // 10 minutes
MAX_COOL_DOWN = 30 * 60          // 30 minutes
DEBOUNCE_TIME_MS = 1000          // 1 second
```

**Cooldown Formula**:
```typescript
coolDown = baseCoolDown + (sqrt(dwellMinutes) * 120)
// Capped at MAX_COOL_DOWN
```

**Flow Context State** (per topic):
```typescript
{
  state: "on" | "off" | "pending_off" | "unknown",
  prevState: string,
  prevPrevState: string,        // Detects on→unknown→off pathology
  lastOn: number,               // Timestamp (ms)
  lastOff: number,
  delay: number,                // Current cooldown (ms)
  coolDownEndTime: number       // Absolute expiry timestamp
}
```

**InfluxDB Measurements**:
- `presence_events` - State transitions, timing, sensor states
- `get_flow_info_events` - Cooldown checks

**Critical**: Treat `pending_off` as `off` for re-triggering (`wasPendingOffTreatedAsOff` flag)

### Scheduling Engine (`src/scheduling/`)

**Purpose**: Time-based automation with continuous/trigger modes

**Schedule Types**:
- **Continuous**: Enforce state throughout active window (plants, climate)
- **Trigger**: Fire once at start/end with ±10min window (blinds, locks)

**Key Files**:
- `schedule/index.ts` (16KB) - Main orchestration, entity matching, precedence resolution
- `schedule/schedules/plants-schedules.ts` - Grow light definitions
- `schedule/schedules/day-night-schedules.ts` - Day/night automation
- `schedule/entity-matching.ts` - Regex/tag-based matching
- `schedule/conditions.ts` - Presence-based conditions
- `types.ts` - Schedule type definitions

**Schedule Structure**:
```typescript
{
  name: string,
  entities: string[] | { entity_id, states }[],
  tags?: string[],
  start: "HH:MM" | { entity_id: "input_datetime.X" },
  end: "HH:MM" | { entity_id: "input_datetime.X" },
  precedence: number,          // Higher wins conflicts
  type: "continuous" | "trigger",
  conditions?: [{ type: "presence", value: "home" | "away" }],
  interpolation?: {
    enabled: boolean,
    preamble_minutes: number,  // Ramp-up before start
    postamble_minutes: number  // Ramp-down after end
  }
}
```

**Plant Schedules**:
- **Global**: 6AM-11PM (precedence 100)
- **Bedroom**: Wakeup-Sleep times (precedence 110)
- **Warocqueanum**: 5 sub-schedules, presence-dependent (precedence 120/30)

**Matching Strategies**:
1. Regex patterns: `regex:(switch|light)\..*grow.*`
2. Tag-based: `tags: ["plants"]` → `tagDefinitions.plants`
3. Exact IDs: `"light.titanic_light"`

**Time Resolution**:
- Static: `"06:00"` → parsed directly
- Entity: `{ entity_id: "sensor.wakeup_time" }` → fetch state
- Midnight crossing: If end < start, adds 1 day to end

### Cache States (`src/cache-states/`)

**Purpose**: Scene snapshots with away-mode conversion

**Key Functions**:
```typescript
createServiceCall(entity: Hass.State) → Hass.Service
  // Maps entity state to turn_on/off with attributes

filterAttributes(domain, service, attrs) → Record<string, any>
  // Preserves: brightness, color, position, temperature
  // Filters by domain: light (8 attrs), fan (1), climate (3), cover (1)

createAwayPayload(states: Hass.Service[]) → Hass.Action[]
  // Light/switch: off, Fan: 33%, Climate: away, Lock: locked, Cover: closed
```

**Files**:
- `cache-house-state.ts` - Snapshot all entities → away payload
- `states-to-actions.ts` - Convert states to action format
- `merge-cached-states.ts` - Merge incoming with global store
- `filter-blacklisted-entities.ts` - Exclude blacklist patterns
- `utils.ts` - Domain-specific attribute filtering

**Supported Domains**: light, switch, fan, climate, lock, cover, media_player

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
  "total": 35,
  "exact": 23,
  "ai-reconciled": 11,
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

### Static States
- **Namespace Aware**: `plants`, `default` namespaces
- **Override Priority**: Static state > schedule > default
- **Blacklist Checked**: Before entity processing

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

**Last Updated**: 2025-11-16
**Total LOC**: 7693 (TypeScript)
**Modules**: 60 source files, 37 compiled outputs
**Deployment**: API-based hot reload (no restart)
