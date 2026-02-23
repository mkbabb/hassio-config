# Home Assistant Configuration

**Version**: 2025.7.2 | **Platform**: macOS Darwin 25.2.0 ARM64
**Location**: 35.804°N, 78.794°W

## Architecture Overview

Sophisticated multi-protocol smart home automation with TypeScript-driven Node-RED logic, Bayesian presence detection, ESPresense Bluetooth triangulation, and energy optimization.

### System Stack

```
┌─────────────────────────────────────────────────────────────┐
│                    Home Assistant Core                       │
│                      (2025.7.2)                              │
├─────────────────────────────────────────────────────────────┤
│  Protocol Layer                                              │
│  ├─ Zigbee: Sonoff USB Dongle Plus (CC2652, Z-Stack)       │
│  ├─ Z-Wave JS: HUSBZB-1 (GE switches, Ecolink sensors)     │
│  ├─ MQTT: Mosquitto 6.5.1 (ESPresense, device updates)     │
│  ├─ WiFi: LIFX, Ecobee, Sonos, HomePods, Samsung TV        │
│  └─ Cloud: Tesla, LG SmartThinQ, Tuya                       │
├─────────────────────────────────────────────────────────────┤
│  Automation Layer                                            │
│  ├─ Node-RED: TypeScript (60+ modules, 7693 LOC)           │
│  ├─ HA Automations: YAML (5 native automations)            │
│  └─ Blueprints: Reusable templates                          │
├─────────────────────────────────────────────────────────────┤
│  Intelligence Layer                                          │
│  ├─ ESPresense: 11 BLE nodes, 3 floors, room triangulation │
│  ├─ Bayesian: Probabilistic presence (90%/95% thresholds)  │
│  ├─ Presence State Machine: Dynamic cooldown (10-30min)    │
│  └─ Scheduling: Time-based continuous enforcement          │
├─────────────────────────────────────────────────────────────┤
│  Data Layer                                                  │
│  ├─ InfluxDB: Metrics (nodered DB, 8 measurements)         │
│  ├─ SQLite: State history (141MB home-assistant_v2.db)     │
│  └─ Flow Context: Per-topic state machines                  │
└─────────────────────────────────────────────────────────────┘
```

## Directory Structure

```
/Volumes/config/
├── configuration.yaml              # Main entrypoint
├── automations.yaml               # 5 native HA automations
├── binary_sensors.yaml            # 2 Bayesian presence sensors
├── scenes.yaml                    # 4 state snapshots (1193 lines)
├── template_entities.yaml         # 8 derived sensors
├── rest_commands.yaml             # 2 remote entity endpoints
├── input_*.yaml                   # 18 helper entities
├── secrets.yaml                   # Credentials (gitignored)
├── .HA_VERSION                    # Core version tracker
│
├── node-red-scripts/              # TypeScript automation (SEE: node-red-scripts/CLAUDE.md)
│   ├── src/                       # 60 TS files, 7693 LOC
│   │   ├── presence/              # Motion detection, state machine
│   │   ├── scheduling/            # Time-based automation
│   │   ├── plants/                # Grow light control
│   │   ├── cache-states/          # Scene management
│   │   ├── remote-entities/       # IR/RF abstraction
│   │   ├── batteries/             # Battery monitoring
│   │   └── utils/                 # Shared utilities
│   ├── dist/                      # Compiled JS (37 files)
│   └── build/                     # Build system (SEE: build/CLAUDE.md)
│       ├── index.ts               # esbuild orchestrator
│       ├── dependency-graph.ts    # Incremental compilation
│       └── deploy/                # Node-RED deployment
│
├── custom_components/             # 5 integrations (SEE: custom_components/CLAUDE.md)
│   ├── entity_guard/              # Conditional entity blocking
│   ├── hacs/                      # Community integration manager
│   ├── smartthinq_sensors/        # LG appliances
│   ├── tesla_custom/              # Vehicle integration
│   └── dwains_dashboard/          # Custom UI framework
│
├── espresense/                    # Bluetooth presence
│   └── config.yaml                # 11 nodes, room mapping
│
├── blueprints/                    # Reusable templates
│   ├── automation/                # motion_light, notify_leaving_zone
│   ├── script/                    # confirmable_notification
│   └── template/                  # inverted_binary_sensor
│
├── python-scripts/                # Utilities
│   └── entities-to-scene.py       # Scene converter with color conversion
│
├── group/                         # Entity collections
│   ├── all_locks.yaml             # Lock grouping
│   └── climate.yaml               # HVAC grouping
│
├── sensor/                        # Platform configs
│   └── esp_presence.yaml          # MQTT room tracking
│
├── light/, fan/, lock/, cover/    # Template entities
│
├── themes/ios-themes/             # iOS-inspired UI
│
├── www/                           # Frontend resources
│   └── community/                 # Custom cards (mushroom, weather, auto-entities)
│
├── home-assistant_v2.db           # 141MB SQLite database
├── zigbee.db                      # ZHA device database
└── zwcfg_0xc596a377.xml          # Z-Wave network config
```

## Connection Information

### Home Assistant API
- **URL**: `http://homeassistant.local:8123`
- **API Base**: `http://homeassistant.local:8123/api/`
- **States**: `GET /api/states`
- **Services**: `POST /api/services/<domain>/<service>`
- **Auth**: Bearer token (from `secrets.yaml`)

### Node-RED
- **URL**: `http://homeassistant.local:1880`
- **API**: REST endpoints at `/endpoint/remote/`
- **Admin API**: `POST /flows` (hot reload deployment)
- **Credentials**: `node-red-scripts/.env`

### InfluxDB
- **URL**: `http://homeassistant.local:8086`
- **Databases**:
  - `homeassistant` - State history
  - `nodered` - Automation metrics (8 measurements)
  - `_internal` - InfluxDB metrics
- **Credentials**: `secrets.yaml` (`influxdb_username`, `influxdb_password`)

### Querying InfluxDB
```bash
# Show databases
curl -G "http://homeassistant.local:8086/query" \
  --data-urlencode "u=${INFLUXDB_USERNAME}" \
  --data-urlencode "p=${INFLUXDB_PASSWORD}" \
  --data-urlencode "q=SHOW DATABASES"

# Query presence events (last hour)
curl -G "http://homeassistant.local:8086/query" \
  --data-urlencode "u=${INFLUXDB_USERNAME}" \
  --data-urlencode "p=${INFLUXDB_PASSWORD}" \
  --data-urlencode "db=nodered" \
  --data-urlencode "q=SELECT * FROM presence_events WHERE time > now() - 1h"
```

## Core Systems

### Presence Detection
- **ESPresense**: 11 ESP32 nodes, Bluetooth RSSI triangulation
- **Bayesian Sensors**: 90% threshold (mike_presence), 95% threshold (mike_asleep_status)
- **State Machine**: Dynamic cooldown (10min default, 30min max), exponential backoff
- **InfluxDB**: `presence_events`, `get_flow_info_events` measurements
- **Details**: See `node-red-scripts/CLAUDE.md` → Presence Detection

### Plant Automation
- **Global Schedule**: 6AM-11PM (via `input_datetime` entities)
- **Bedroom Schedule**: Wakeup-Sleep times (weekday/weekend aware)
- **Warocqueanum**: 5 sub-schedules, presence-dependent (home/away)
- **Entities**: 15+ grow light switches/lights
- **Details**: See `node-red-scripts/CLAUDE.md` → Plant Automation

### Energy Optimization
- **Time-of-Use**: Summer/winter rate schedules
- **Pre-cooling**: 30min before peak periods
- **Climate Control**: Dynamic setpoint adjustment
- **Details**: `node-red-scripts/src/time-of-use.ts`

### State Caching
- **Scene Snapshots**: All entity states (filtered by blacklist)
- **Away Mode**: Automatic state conversion (lights off, climate away, fans low)
- **Attribute Preservation**: Brightness, color, position, temperature
- **Details**: See `node-red-scripts/CLAUDE.md` → Cache States

## Entity Summary

| Domain | Count | Notes |
|--------|-------|-------|
| light | 35+ | Grouped fixtures (5 groups), individual lights, template (monitor) |
| binary_sensor | 2 | Bayesian presence/sleep |
| sensor | 10+ | ESPresense (2), template (8) |
| switch | 20+ | Grow lights, smart plugs |
| fan | 1 | Template (Dyson IR control) |
| cover | 6 | Blind groups + individuals |
| lock | 2 | Front/back doors |
| climate | 2 | Upstairs/downstairs zones |
| input_boolean | 4 | State flags |
| input_datetime | 6 | Schedule time pickers |
| input_select | 4 | Status selectors |
| input_text | 4 | Remote entity state JSON |
| scene | 4 | State snapshots |
| group | 6 | Collections |
| automation | 5 | Native HA automations |

## Key Integrations

### Custom Components (See: custom_components/CLAUDE.md)
- **Entity Guard** v1.0.0 - Conditional entity blocking
- **HACS** v2.0.5 - Community integration manager
- **SmartThinQ** v0.41.2 - LG appliance control
- **Tesla Custom** v3.25.3 - Vehicle integration
- **Dwains Dashboard** v3.8.0 - Custom UI

### Protocol Integrations
- **Zigbee**: Third Reality smart plugs, lights
- **Z-Wave**: GE/Enbrighten switches, Ecolink sensors
- **MQTT**: ESPresense room tracking
- **WiFi**: LIFX bulbs, Ecobee thermostats, Sonos, HomePods
- **Cloud**: Tesla vehicles, LG SmartThinQ, Tuya

## Development Workflow

### Node-RED TypeScript Development
```bash
# Watch mode (auto-rebuild on file changes)
cd node-red-scripts
npm run watch

# Build and deploy
npm run build
npm run deploy -- src/presence/presence.ts

# Or combined
npm run build:deploy
```

### Generate Function Mappings (Initial Setup)
```bash
cd node-red-scripts
npm run map           # Hash-based mapping
npm run map -- --ai   # With AI reconciliation (requires OPENAI_API_KEY)
```

### Deploy to Node-RED
```bash
# Single file
npm run deploy -- src/presence/presence.ts

# All mapped functions
npm run deploy:all

# Dry run (preview only)
npm run deploy -- src/presence/presence.ts --dry-run
```

## Critical Configuration

### Service Call Format (Updated 2025-08-04)
```yaml
# DEPRECATED (old format)
domain: light
service: turn_on

# USE (modern format)
action: "light.turn_on"
```

### Presence Detection State Machine
- **States**: off, on, pending_off, unknown, reset
- **Critical**: Treat `pending_off` as `off` for re-triggering
- **Logging**: Store last 10 state transitions in flow history
- **Debug Flags**: `wasPendingOffTreatedAsOff`, `coolDownCancelled`

### InfluxDB Data Types
- **Booleans**: Convert to integers (0/1) via `safeBooleanAsInt()`
- **Objects**: Convert to counts or JSON strings
- **Strings**: Use `safeString()` for proper encoding
- **Numbers**: Use `safeNumber()` to handle null/undefined

### Node-RED Standards
- **HA Server**: Always use `79544c2b.6ccc64`
- **Node Versions**: state-changed v6, api-call-service v7, api-current-state v3
- **Naming**: Lowercase descriptive (e.g., "state_changed: input_boolean.plants_trigger_on")
- **Positioning**: Align evenly (state nodes x=680, current_state x=1180, service x=1610)

## Blacklisted Entities

Global blacklist (applies to presence, cache-states, etc.):
```typescript
[
  "son_of_toast",              // Tesla vehicle
  /.*grow.*/i,                 // Grow lights
  /.*blinds.*/i,               // Window covers
  /.*air_purifier.*/i,         // Air quality
  "switch.washing_machine",
  "switch.dryer",
  /espresense_.*/i,            // Presence sensors
  /.*sonos_beam.*/i            // Speakers
]
```

## Common Queries

### InfluxDB Debugging
```sql
-- Recent presence events for a room
SELECT time, presence_state, previous_state, action, sensor_states
FROM nodered.presence_events
WHERE topic =~ /bathroom/ AND time > now() - 1h

-- Failed light activations
SELECT time, presence_state, action, sensor_states
FROM nodered.presence_events
WHERE action = 'none' AND presence_state = 'on'

-- Plant schedule activity
SELECT entity_id, schedule_name, schedule_active
FROM nodered.plant_events
WHERE time > now() - 24h
```

## File References

- **Node-RED Automation**: `node-red-scripts/CLAUDE.md`
- **Build System**: `node-red-scripts/build/CLAUDE.md`
- **Custom Components**: `custom_components/CLAUDE.md`
- **ESPresense Config**: `espresense/config.yaml`
- **Bayesian Sensors**: `binary_sensors.yaml`
- **Templates**: `template_entities.yaml`
- **Scenes**: `scenes.yaml`

## Version Information

- **Home Assistant**: 2025.7.2
- **Node-RED**: TypeScript 5.9.3, esbuild 0.25.11
- **Python**: 3.12+ (for utilities)
- **InfluxDB**: Latest (via addon)
- **Mosquitto MQTT**: 6.5.1

---

**Last Updated**: 2025-11-16
**Git Branch**: master
**Total Source Files**: 60 TypeScript (7693 LOC) + 37 YAML configs
