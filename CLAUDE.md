# Home Assistant Configuration

**Version**: 2025.7.2 | **Platform**: macOS Darwin 25.0.0 ARM64 | **Location**: 35.804°N, 78.794°W

## Directory Structure

```
/Volumes/config/
├── automations.yaml          # Bathroom light gates, smart lamp sequences
├── binary_sensors.yaml        # Bayesian presence/sleep detection
├── configuration.yaml         # Modular includes, default_config
├── customize.yaml            # Entity customizations
├── scripts.yaml              # Reusable action sequences  
├── secrets.yaml              # API keys, passwords
├── .HA_VERSION               # Core version tracker
├── home-assistant_v2.db      # Primary SQLite database
├── zigbee.db                 # ZHA database
├── zwcfg_0xc596a377.xml      # Z-Wave configuration
├── blueprints/               # Reusable automation templates
├── custom_components/        # HACS, Dwains Dashboard, SmartThinQ, Tesla Custom
├── espresense/              # Room-level Bluetooth presence detection
├── group/                   # Entity groupings (locks, climate)
├── node-red-scripts/        # TypeScript automation logic
├── python-scripts/          # entities-to-scene.py converter
├── sensor/                  # MQTT room sensors, esp_presence.yaml
├── themes/                  # iOS-inspired UI themes
└── www/                     # Frontend resources (mushroom, weather cards)
```

## Protocol Stack

**Zigbee**: Sonoff Zigbee 3.0 USB Dongle Plus (CC2652, Z-Stack 20210708) - Third Reality smart plugs  
**Z-Wave JS**: HUSBZB-1 controller - GE/Enbrighten switches/dimmers, Ecolink door sensors  
**MQTT**: Mosquitto 6.5.1 - ESPresense room tracking, device state updates  
**WiFi**: LIFX bulbs, Ecobee thermostats, Sonos Beam, Apple HomePods, Samsung TV  
**Cloud**: Tesla vehicles, LG SmartThinQ appliances, Tuya smart plugs  

## Presence Detection

**ESPresense**: 10+ ESP32 nodes with coordinate-mapped rooms across 3 floors. Tracks tiles, phones, watches, keys via Bluetooth RSSI triangulation. 10s presence timeout, 120s away timeout.

**Bayesian Sensors**:
- `binary_sensor.mike_presence`: 90% probability threshold from device_tracker.fff
- `binary_sensor.mike_asleep_status`: Combines home/day status, activity, battery state, bedroom sensor, lights percentage

## Automation Architecture

**Node-RED**: TypeScript scripts compiled to JavaScript with custom build system. REST API at `localhost:1880/endpoint/remote/`
**Node-RED Flows**: Located at `/Volumes/addon_configs/a0d7b954_nodered/`

**Key Scripts**:
- `presence.ts`: Dynamic cool-down (10-30min), exponential backoff based on dwell time
- `battery.ts`: Low (<30%) and critical (<15%) notifications
- `time-of-use.ts`: Summer/winter rate schedules, pre-cooling logic
- `plants/schedule.ts`: Grow light automation (6AM-11PM global, custom bedroom/penguin schedules)

**Blacklisted Entities**: `son_of_toast` (car), `/.*grow.*/`, `/.*blinds.*/`, air purifiers, washer/dryer, ESPresense entities

## Custom Components

**HACS 2.0.5**: Community integration manager  
**SmartThinQ 0.41.1**: LG appliance control via wideq library  
**Tesla Custom 3.25.0**: Enhanced vehicle integration with TeslaMate support  
**Dwains Dashboard 3.8.0**: Custom Lovelace UI framework  

## State Management

**Cache States**: Snapshots all entity states for scene restoration. Groups actions by type to minimize API calls.

**Remote Entities**: IR/RF abstraction layer for Dyson fans, office monitor lights with brightness/color temperature mapping.

**Time Templates**: Wake/sleep schedules differentiated by weekday/weekend, day type detection with dynamic icons.

## Build System

Node-RED scripts use custom `build.ts` with esbuild, dependency tracking, incremental compilation. Appends `return msg;` to each function for Node-RED compatibility. Watch mode for development.

## Energy Optimization

Time-of-use scheduling with peak/off-peak rates. Pre-cooling triggers 30min before peak periods. Climate setpoints adjust based on occupancy and rate schedule.