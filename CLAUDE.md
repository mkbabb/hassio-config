# Home Assistant Configuration

**Version**: 2025.7.2 | **Platform**: macOS Darwin 25.0.0 ARM64 | **Location**:
35.804°N, 78.794°W

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

### Querying InfluxDB

```bash
# Show databases
curl -G "http://homeassistant.local:8086/query" \
  --data-urlencode "u=${INFLUXDB_USERNAME}" \
  --data-urlencode "p=${INFLUXDB_PASSWORD}" \
  --data-urlencode "q=SHOW DATABASES"

# Query Node-RED presence events
curl -G "http://homeassistant.local:8086/query" \
  --data-urlencode "u=${INFLUXDB_USERNAME}" \
  --data-urlencode "p=${INFLUXDB_PASSWORD}" \
  --data-urlencode "db=nodered" \
  --data-urlencode "q=SELECT * FROM presence_events WHERE time > now() - 1h"
```

## Directory Structure

```
/Volumes/config/
├── configuration.yaml          # Main config entrypoint
├── automations.yaml            # Bathroom lights, smart lamps
├── binary_sensors.yaml         # Bayesian presence/sleep detection
├── scripts.yaml                # Reusable action sequences
├── scenes.yaml                 # Saved state snapshots
├── customize.yaml              # Entity customizations
├── secrets.yaml                # API keys, passwords
├── input_*.yaml                # Helper entities (boolean/select/datetime)
├── template_entities.yaml      # Template sensors/switches
├── rest_commands.yaml          # HTTP service commands
├── .HA_VERSION                 # Core version tracker
├── home-assistant_v2.db        # Primary SQLite database
├── zigbee.db                   # ZHA device database
├── zwcfg_0xc596a377.xml        # Z-Wave network config
│
├── blueprints/                 # Reusable automation templates
│   └── automation/             # Motion lights, zone notifications
├── custom_components/          # Third-party integrations
│   ├── entity_guard/           # Conditional entity blocking
│   ├── hacs/                   # Community integration manager
│   ├── smartthinq_sensors/     # LG appliance control
│   ├── tesla_custom/           # Enhanced vehicle integration
│   └── dwains_dashboard/       # Custom UI framework
├── espresense/                 # Bluetooth presence detection
│   └── config.yaml             # ESP32 coordinate mapping
├── group/                      # Entity collections
│   ├── all_locks.yaml          # Security device grouping
│   └── climate.yaml            # HVAC system grouping
├── node-red-scripts/           # TypeScript automation logic
│   ├── src/                    # Source modules
│   │   ├── presence/           # Motion detection with cooldowns
│   │   ├── cache-states/       # Scene state management
│   │   ├── plants/             # Grow light scheduling
│   │   └── utils/              # Shared utilities
│   └── dist/                   # Compiled JavaScript
├── python-scripts/             # Python utilities
│   └── entities-to-scene.py   # Scene conversion tool
├── sensor/                     # Sensor configurations
│   └── esp_presence.yaml      # ESPresense room tracking
├── themes/                     # UI styling
│   └── ios-themes/             # iOS-inspired themes
└── www/                        # Frontend resources
    └── community/              # Custom cards
        ├── lovelace-mushroom/  # Modern card designs
        └── weather-card/       # Weather displays
```

## Protocol Stack

**Zigbee**: Sonoff Zigbee 3.0 USB Dongle Plus (CC2652, Z-Stack 20210708) - Third Reality
smart plugs  
**Z-Wave JS**: HUSBZB-1 controller - GE/Enbrighten switches/dimmers, Ecolink door
sensors  
**MQTT**: Mosquitto 6.5.1 - ESPresense room tracking, device state updates  
**WiFi**: LIFX bulbs, Ecobee thermostats, Sonos Beam, Apple HomePods, Samsung TV  
**Cloud**: Tesla vehicles, LG SmartThinQ appliances, Tuya smart plugs

## Presence Detection

**ESPresense**: 10+ ESP32 nodes with coordinate-mapped rooms across 3 floors. Tracks
tiles, phones, watches, keys via Bluetooth RSSI triangulation. 10s presence timeout,
120s away timeout.

**Bayesian Sensors**:

-   `binary_sensor.mike_presence`: 90% probability threshold from device_tracker.fff
-   `binary_sensor.mike_asleep_status`: Combines home/day status, activity, battery
    state, bedroom sensor, lights percentage

## Automation Architecture

**Node-RED**: TypeScript scripts compiled to JavaScript with custom build system. REST
API at `localhost:1880/endpoint/remote/` **Node-RED Flows**: Located at
`/Volumes/addon_configs/a0d7b954_nodered/flows.json` **Node-RED Deploy**: Preferred:
`POST http://localhost:1880/flows` with headers `Node-RED-Deployment-Type: nodes`,
`Node-RED-API-Version: v2`, Basic auth. Only restarts modified nodes, no reload needed

### Node-RED Standards

**HA Server**: Always use `79544c2b.6ccc64` for all Home Assistant nodes **Node
Versions**: `server-state-changed` v6, `api-call-service` v7, `api-current-state` v3
**Naming**: Lowercase descriptive names (e.g., "state_changed:
input_boolean.plants_trigger_on", "turn off plants_trigger_on") **Positioning**: Align
nodes evenly - state nodes at x=680, current_state at x=1180, service calls at x=1610
**Required Fields**: Set `outputs: 2` for state_changed, `entities` object structure
(not `entityidfilter`), proper `ifState` conditions

**Key Scripts**:

-   `presence.ts`: Dynamic cool-down (10-30min), exponential backoff based on dwell time
-   `battery.ts`: Low (<30%) and critical (<15%) notifications
-   `time-of-use.ts`: Summer/winter rate schedules, pre-cooling logic
-   `plants/schedule.ts`: Grow light automation (6AM-11PM global, custom bedroom/penguin
    schedules)

**Blacklisted Entities**: `son_of_toast` (car), `/.*grow.*/`, `/.*blinds.*/`, air
purifiers, washer/dryer, ESPresense entities

## Custom Components

**Entity Guard 1.0.0**: Conditional entity blocking for lights and other domains  
**HACS 2.0.5**: Community integration manager  
**SmartThinQ 0.41.1**: LG appliance control via wideq library  
**Tesla Custom 3.25.0**: Enhanced vehicle integration with TeslaMate support  
**Dwains Dashboard 3.8.0**: Custom Lovelace UI framework

## State Management

**Cache States**: Snapshots all entity states for scene restoration. Groups actions by
type to minimize API calls.

**Remote Entities**: IR/RF abstraction layer for Dyson fans, office monitor lights with
brightness/color temperature mapping.

**Time Templates**: Wake/sleep schedules differentiated by weekday/weekend, day type
detection with dynamic icons.

## Build System

Node-RED scripts use custom `build.ts` with esbuild, dependency tracking, incremental
compilation. Appends `return msg;` to each function for Node-RED compatibility. Watch
mode for development.

## Energy Optimization

Time-of-use scheduling with peak/off-peak rates. Pre-cooling triggers 30min before peak
periods. Climate setpoints adjust based on occupancy and rate schedule.

## Development Guidelines & Edicts

### Service Call Updates (2025-08-04)

-   **DEPRECATED**: Separate `domain` and `service` properties in Home Assistant service
    calls
-   **USE**: Single `action` property in format `"domain.service"` (e.g.,
    `"light.turn_on"`)
-   **VALIDATION**: Always check service names aren't `"unavailable"` or empty
-   **FALLBACK**: Support both formats for backward compatibility

### Presence Detection State Machine

-   **CRITICAL**: Treat `pending_off` state as `off` for re-triggering lights
-   **LOGGING**: Store last 10 state transitions in flow history for debugging
-   **DEBUG**: Include `wasPendingOffTreatedAsOff` and `coolDownCancelled` flags

### InfluxDB Data Types

-   **BOOLEANS**: Convert to integers (0/1) using `safeBooleanAsInt()`
-   **OBJECTS**: Convert to counts or JSON strings, never store raw objects
-   **STRINGS**: Use `safeString()` to ensure proper encoding
-   **NUMBERS**: Use `safeNumber()` to handle null/undefined values

### Debugging Presence Issues

1. Check `nodered.presence_events` for state transitions
2. Look for `action: "none"` entries - indicates detection without action
3. Verify `previous_state` and `previous_previous_state` for state history
4. Check `sensor_states` JSON field for individual sensor status
5. Monitor `was_pending_off_treated_as_off` flag for re-trigger behavior

### Common Queries

```sql
-- Recent presence events for a room
SELECT time, presence_state, previous_state, action, sensor_states
FROM nodered.presence_events
WHERE topic =~ /bathroom/ AND time > now() - 1h

-- Failed light activations
SELECT time, presence_state, action, sensor_states
FROM nodered.presence_events
WHERE action = 'none' AND presence_state = 'on'
```
