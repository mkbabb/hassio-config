# Node-RED Scripts

TypeScript automation functions compiled to JavaScript for Node-RED. Custom build system with dependency tracking and incremental compilation.

## Build System

**Command**: `npm run build` (production) | `npm run build:dev` (watch mode)  
**Engine**: esbuild via custom `build.ts` - tracks dependencies, caches compiled output, appends `return msg;` for Node-RED compatibility  
**Output**: `dist/` directory mirrors `src/` structure  

## Core Modules

### presence/presence.ts
Room occupancy management with intelligent cool-down periods.
- **Cool-down**: 10min default, 30min max, exponentially increases based on dwell time
- **State tracking**: Per-topic presence sensor aggregation in flow context
- **Entity control**: Filters blacklisted entities, groups actions by type
- **Inputs**: `{topic: "sensor_id", payload: {state: "on|off|unknown"}}`
- **Outputs**: Grouped Home Assistant service calls

### batteries/battery.ts
Monitors all battery entities, generates tiered notifications.
- **Thresholds**: <30% low, <15% critical
- **Output**: Sorted by level (lowest first), formatted notification strings

### cache-states/
**cache-house-state.ts**: Snapshots entity states for scene restoration. Filters unavailable entities, creates service calls preserving attributes (brightness, color, fan speed).  
**states-to-actions.ts**: Converts service calls to grouped actions for efficiency.  
**filter-blacklisted-entities.ts**: Central blacklist logic - excludes grow lights, air purifiers, ESPresense entities.

### chronos/
**time-switch.ts**: Converts Home Assistant input entities to Chronos schedule objects. Stores in flow context.  
**cron.ts**: Cron expression evaluation for time-based triggers.  
**guest-daytime.ts**: Guest mode schedule overrides.

### plants/
**schedule.ts**: Named grow light schedules with regex entity matching.  
**schedules.ts**: Static definitions - global (6AM-11PM), bedroom (9AM-11PM), penguin (9AM-6:45PM).  
Override precedence: manual > schedule > default state.

### time-of-use.ts
Electricity rate optimization with pre-cooling logic.
- **Schedules**: Summer (Jun-Sep) and Winter with peak/off-peak rates
- **Pre-cooling**: Triggers 30min before peak periods
- **Climate control**: Adjusts setpoints based on occupancy and rates

### remote-entities/
IR/RF device abstraction layer.
- **dyson-fan.ts**: Virtual fan control via IR commands
- **office-monitor-light.ts**: Brightness (0-100) and color temperature (2700K-6500K) mapping

### utils/utils.ts
Shared utilities for entity manipulation, time calculations, action grouping.
- **Entity functions**: `getDomain()`, `getBasename()`, `createServiceCall()`
- **Time helpers**: `timeToMinutes()`, `isTimeInRange()`, `normalizeTimeRange()`
- **Blacklist**: Regex patterns and exact matches for entity filtering

## Entity Blacklist

```typescript
const BLACKLISTED_ENTITIES = [
    "son_of_toast",           // Tesla
    /.*grow.*/i,             // Grow lights
    /.*blinds.*/i,           // Window coverings
    /.*air_purifier.*/i,     // Air quality
    "switch.washing_machine",
    "switch.dryer",
    "sensor.espresense_*",   // Presence sensors
    "switch.garage_door"
];
```

## Message Flow

1. **Input**: Node-RED message with topic (entity ID) and payload (state/data)
2. **Processing**: TypeScript logic with state management via flow context
3. **Output**: Grouped Home Assistant actions or modified message

## Integration

**Manual deployment**: Copy compiled JavaScript from `dist/` to Node-RED function nodes  
**API endpoint**: REST commands via `http://localhost:1880/endpoint/remote/`  
**State persistence**: Flow-level context storage for timers, states, schedules  

## Flow Deployment (Preferred)

```bash
# API deployment - only restarts modified nodes, no full reload
curl -X POST http://localhost:1880/flows \
  -H "Content-Type: application/json" \
  -H "Node-RED-Deployment-Type: nodes" \
  -H "Node-RED-API-Version: v2" \
  -u "username:password" \
  -d '{"flows": [...]}'
```

Alternative: Edit `/Volumes/addon_configs/a0d7b954_nodered/flows.json` + `ha addon restart a0d7b954_nodered`

## Node-RED Development Standards

### Home Assistant Node Configuration
- **Server ID**: Always use `79544c2b.6ccc64` for the `server` field
- **Node Versions**: 
  - `server-state-changed`: version 6
  - `api-call-service`: version 7
  - `api-current-state`: version 3
- **Entity Structure**: Use `entities: {entity: ["id"], substring: [], regex: []}` not `entityidfilter`

### Node Naming & Positioning
- **Names**: Lowercase, descriptive (e.g., "state_changed: sensor.motion", "turn off light")
- **Positioning**: Maintain consistent x-coordinates:
  - State/trigger nodes: x=680
  - Current state nodes: x=1180
  - Service call nodes: x=1610
  - Vertical spacing: 200px between related nodes

### Required Node Properties
```json
// server-state-changed
{
  "type": "server-state-changed",
  "server": "79544c2b.6ccc64",
  "version": 6,
  "outputs": 2,
  "ifState": "on",
  "ifStateOperator": "is",
  "outputOnlyOnStateChange": true
}

// api-call-service
{
  "type": "api-call-service",
  "server": "79544c2b.6ccc64",
  "version": 7,
  "domain": "input_boolean",
  "service": "turn_off",
  "entityId": ["input_boolean.example"]
}
```  

## Dependencies

Build: typescript@5.8.3, vite@6.3.2, esbuild@0.25.3, tsx@4.19.3  
Runtime: Node-RED flow context, Home Assistant WebSocket API