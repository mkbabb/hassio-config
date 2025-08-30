# Node-RED Scripts

TypeScript automation functions compiled to JavaScript for Node-RED. Custom build system with dependency tracking and incremental compilation.

## Build System

**Command**: `npm run build` (production) | `npm run build:dev` (watch mode)  
**Engine**: esbuild via custom `build.ts` - tracks dependencies, caches compiled output, appends `return msg;` for Node-RED compatibility  
**Output**: `dist/` directory mirrors `src/` structure  

## Connection Information

### Home Assistant API

-   **URL**: `http://homeassistant.local:8123`
-   **API Base**: `http://homeassistant.local:8123/api/`
-   **States**: `GET /api/states` - List all entity states
-   **Services**: `POST /api/services/<domain>/<service>` - Call services
-   **Authentication**: Bearer token required in headers
-   **Credentials**: Located at `node-red-scripts/.env`

### Node-RED

-   **URL**: `http://homeassistant.local:1880`
-   **API**: REST endpoints at `/endpoint/remote/`
-   **Admin API**: Hot reload deployment via `/flows` endpoint
-   **Credentials**: Username and password in `node-red-scripts/.env`

### InfluxDB

-   **URL**: `http://homeassistant.local:8086` or `http://a0d7b954-influxdb:8086`
-   **Credentials**: `secrets.yaml` (`influxdb_username`, `influxdb_password`)
-   **Environment**: `INFLUXDB_USERNAME`, `INFLUXDB_PASSWORD`
-   **Databases**:
    -   `homeassistant` - State history
    -   `nodered` - Automation metrics (presence_events, schedule_events, plant_events, cache_events, remote_events)
    -   `_internal` - InfluxDB metrics

## Directory Structure

```
src/
├── batteries/
│   └── battery.ts                    # Battery level notifications
├── cache-states/
│   ├── cache-house-state.ts         # Snapshot entity states
│   ├── filter-blacklisted-entities.ts # Remove blacklisted entities
│   └── states-to-actions.ts         # Convert states to actions
├── garage-door/
│   └── controller.ts                # Garage automation logic
├── plants/
│   └── set-static-state.ts          # Plant state management
├── presence/
│   ├── presence.ts                  # Main presence detection
│   └── utils.ts                     # Presence calculations
├── remote-entities/
│   └── service-call/                # IR/RF device control
│       ├── fan.ts                   # Fan service calls
│       └── light.ts                 # Light service calls
├── scheduling/
│   ├── schedule.ts                  # Main scheduling engine
│   └── schedules/
│       ├── plants-schedules.ts      # Grow light schedules
│       └── day-night-schedules.ts   # Day/night rules
├── utils/
│   ├── datetime.ts                  # Date/time utilities
│   ├── ha-entities.ts               # Entity helpers
│   └── utils.ts                     # General utilities
├── door-state.ts                    # Door sensor notifications
└── time-of-use.ts                   # Energy rate scheduling
```

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

## TypeScript to Node-RED Deployment

**IMPORTANT**: Always use the automated deployment system when updating Node-RED functions from TypeScript files.

### Quick Start

1. **Setup** (one-time):
   ```bash
   # Generate function mappings
   npm run map                # Basic mapping
   npm run map -- --ai        # With AI reconciliation
   
   # Configure .env with Home Assistant credentials
   ```

2. **Deploy a single file**:
   ```bash
   npm run deploy -- src/chronos/cron.ts
   ```

3. **Deploy all mapped functions**:
   ```bash
   npm run deploy -- --all
   ```

### Deployment Workflow

**IMPORTANT**: When modifying TypeScript files, you must build before deploying!

1. **Edit**: Make changes to TypeScript files in `src/`
2. **Build**: Run `npm run build` to compile TypeScript to JavaScript
   - In development: Use `npm run watch` for automatic rebuilds
   - The deployment system deploys the compiled JS files from `dist/`, NOT the TS files
3. **Deploy**: Run `npm run deploy -- src/path/to/file.ts`
   - This deploys the corresponding `dist/path/to/file.js` to Node-RED
   - Uses hot reload via Node-RED Admin API (no restart needed)
   - Automatically creates backups before deployment

**Common workflow**:
```bash
# Edit your TypeScript file
# Then build and deploy:
npm run build && npm run deploy -- src/chronos/cron.ts

# Or use watch mode during development:
npm run watch  # In one terminal
npm run deploy -- src/chronos/cron.ts  # In another terminal when ready
```

### Deployment Commands

```bash
# Deploy specific files
npm run deploy -- src/presence/presence.ts src/time-of-use.ts

# Deploy with options
npm run deploy -- src/presence/presence.ts --force      # Skip change detection
npm run deploy -- src/presence/presence.ts --dry-run    # Preview changes
npm run deploy -- src/presence/presence.ts --no-backup  # Skip backup

# Rename nodes to match filenames
npm run deploy -- --all --rename
npm run deploy -- --rename-only --dry-run
```

### Node Mapping

The system maintains mappings between TypeScript files and Node-RED function nodes:
- **Exact match**: Code hash matches after normalization
- **AI reconciled**: GPT-4 matches unmapped functions (75%+ confidence)
- **Manual mapping**: Edit `src/deploy/mappings/node-mappings.json`

Mappings are stored with confidence levels to prevent accidental overwrites.

### Authentication

Configure in `.env`:
- **HA_USERNAME** & **HA_PASSWORD**: Home Assistant credentials for Node-RED API
- **HA_TOKEN**: Long-lived access token (fallback for addon restart)
- **OPENAI_API_KEY**: Optional, for AI reconciliation

### Why Use Deployment System?

- **Speed**: Hot reload without Node-RED restart
- **Safety**: Automatic backups, change detection
- **Accuracy**: Guaranteed correct function updates
- **Tracking**: Know exactly which TS files map to which nodes

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