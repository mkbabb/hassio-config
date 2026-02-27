# Home Assistant Configuration

**Version**: 2025.7.2 | **Platform**: macOS Darwin 25.2.0 ARM64
**Location**: 35.804°N, 78.794°W

## Architecture Overview

Multi-protocol smart home automation with TypeScript-driven Node-RED logic, registry-based scheduling, room-level presence detection, scene rollback, and energy optimization.

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
│  ├─ Node-RED: TypeScript (88 modules, ~11.5K LOC)          │
│  ├─ HA Automations: YAML (5 native automations)            │
│  └─ Blueprints: Reusable templates                          │
├─────────────────────────────────────────────────────────────┤
│  Intelligence Layer                                          │
│  ├─ Scheduling: Registry-based, precedence + CRUD API      │
│  ├─ Presence DFA: 9 areas, dynamic cooldown, registry      │
│  ├─ ESPresense: 11 BLE nodes, 3 floors, triangulation      │
│  ├─ Bayesian: Probabilistic presence (90%/95% thresholds)  │
│  └─ State Publishing: 30+ HA sensors from Node-RED         │
├─────────────────────────────────────────────────────────────┤
│  Data Layer                                                  │
│  ├─ InfluxDB: Metrics (nodered DB, 8 measurements)         │
│  ├─ SQLite: State history (home-assistant_v2.db)           │
│  ├─ Global Context: Registries (schedule, presence)        │
│  └─ Flow Context: Per-room DFA state machines              │
└─────────────────────────────────────────────────────────────┘
```

## Directory Structure

```
/Volumes/config/
├── configuration.yaml              # Main entrypoint
├── automations.yaml               # 5 native HA automations
├── binary_sensors.yaml            # 2 Bayesian presence sensors
├── scenes.yaml                    # 4 state snapshots
├── template_entities.yaml         # Template sensors (wakeup/sleep, schedule count)
├── rest_commands.yaml             # Remote entity + schedule API endpoints
├── input_*.yaml                   # 22 helper entities
├── secrets.yaml                   # Credentials (gitignored)
│
├── docs/                          # System documentation
│   ├── SCHEDULING.md              # Schedule engine, registry, precedence
│   ├── PRESENCE.md                # Presence DFA, areas, cooldown
│   ├── CACHE-STATES.md            # Home/away cache + scene rollback
│   ├── PLANTS.md                  # Grow light automation
│   ├── API.md                     # REST API reference (9 endpoints)
│   ├── NODE-RED-FLOWS.md          # Flow tabs, subflows, node mapping
│   └── BUILD-DEPLOY.md            # TypeScript build + deploy pipeline
│
├── node-red-scripts/              # TypeScript automation
│   ├── src/                       # 88 TS files, ~11.5K LOC
│   │   ├── presence/              # 18 files — DFA, registry, API, publishing
│   │   ├── scheduling/            # 25 files — Engine, registry, API, publishing
│   │   ├── cache-states/          # 14 files — Away/home cache, rollback
│   │   ├── plants/                # 5 files — Grow light control
│   │   ├── remote-entities/       # 3 files — IR/RF abstraction
│   │   ├── batteries/             # 2 files — Battery monitoring
│   │   └── utils/                 # 6 files — Shared utilities
│   ├── dist/                      # Compiled JS (37 files)
│   └── build/                     # Build system
│       └── deploy/                # Node-RED deployment + mappings
│
├── custom_components/             # 6 integrations
│   ├── entity_guard/              # Conditional entity blocking
│   ├── scene_rollback/            # Pre-scene state capture
│   ├── hacs/                      # Community integration manager
│   ├── smartthinq_sensors/        # LG appliances
│   ├── tesla_custom/              # Vehicle integration
│   └── dwains_dashboard/          # Custom UI framework
│
├── espresense/                    # Bluetooth presence
├── blueprints/                    # Reusable templates
├── python-scripts/                # Utilities
└── group/, sensor/, light/, fan/, lock/, cover/
```

## Core Systems

### Scheduling Engine (See: `docs/SCHEDULING.md`)
- **Registry**: `global.get("scheduleRegistry")` — 13 static schedules, dynamic CRUD via API
- **Types**: Continuous (enforce state) and Trigger (fire once at ±10min window)
- **Precedence**: Higher number wins when multiple schedules match same entity
- **Conditions**: Presence-gated (home/away), entity state-gated
- **Interpolation**: Sunrise/sunset simulation with brightness + color temp fading
- **REST API**: 6 endpoints at `/endpoint/schedules/` + `/endpoint/schedule-status`
- **Sensors**: `sensor.schedule_{name}_status`, `sensor.schedule_{name}_progress`, aggregates

### Presence Detection (See: `docs/PRESENCE.md`)
- **DFA**: 4 states (off, on, pending_off, unknown)
- **9 Areas**: Data-driven from `global.get("presenceRegistry")` with 1-4 sensors each
- **Cooldown**: Dynamic — `baseCoolDown + min(dwellMinutes, 60) × 10`, max 20min
- **Namespace Blacklist**: Presence entities excluded from scheduling + cache restore
- **REST API**: 5 endpoints at `/endpoint/presence/`
- **Sensors**: `sensor.presence_{topic}_state`, `sensor.presence_{topic}_cooldown`

### Plant Automation (See: `docs/PLANTS.md`)
- **Global Schedule**: 6AM-11PM via `input_datetime` entities
- **Bedroom**: Wakeup-Sleep times (weekday/weekend aware)
- **Warocqueanum**: 5 sub-schedules, presence-dependent
- **Shelf Override**: Bonus room motion → immediate turn-on, 10min cooldown
- **Entities**: 15+ grow light switches/lights (globally blacklisted from cache/presence)

### Cache States & Rollback (See: `docs/CACHE-STATES.md`)
- **Away**: Snapshot all entities, generate away payload (lights off, fans 33%, climate away)
- **Home**: Restore non-presence entities from cache
- **Scene Rollback**: LIFO stack, captures pre-scene state via custom component
- **Presence Filtering**: 5 files exclude presence-tracked entities from cache operations

### Energy Optimization
- **Time-of-Use**: Summer/winter rate schedules
- **Pre-cooling**: 30min before peak periods
- **Details**: `node-red-scripts/src/time-of-use.ts`

## Connection Information

### Home Assistant API
- **URL**: `http://homeassistant.local:8123`
- **Auth**: Bearer token (from `secrets.yaml`)

### Node-RED
- **URL**: `http://homeassistant.local:1880`
- **REST API**: 16 endpoints under `/endpoint/` (See: `docs/API.md`)
- **Admin API**: `POST /flows` (hot reload, currently falls back to file-based)
- **Credentials**: `node-red-scripts/.env`

### InfluxDB
- **URL**: `http://homeassistant.local:8086`
- **Databases**: `homeassistant` (state history), `nodered` (8 measurements)

## Entity Summary

| Domain | Count | Notes |
|--------|-------|-------|
| light | 35+ | Grouped fixtures, individual, template (monitor) |
| binary_sensor | 2 | Bayesian presence/sleep |
| sensor | 40+ | ESPresense (2), template (8), schedule (28+), presence (18) |
| switch | 20+ | Grow lights, smart plugs |
| fan | 1 | Template (Dyson IR) |
| cover | 6 | Blind groups + individuals |
| lock | 2 | Front/back doors |
| climate | 2 | Upstairs/downstairs zones |
| input_boolean | 7 | schedule_pause, presence_pause, plants_trigger_on/off, scene_rollback |
| input_datetime | 6 | Schedule time pickers |
| input_select | 4 | home_status, day_status, awake_status, force_day_status |
| input_text | 4 | Remote entity state JSON |

## Development Workflow

```bash
cd node-red-scripts

# Standard loop
npm run build && npm run deploy -- src/presence/presence.ts

# Watch mode (auto-rebuild)
npm run watch

# Deploy all
npm run build && npm run deploy:all

# Generate mappings (after adding new function nodes)
npm run map
```

See: `docs/BUILD-DEPLOY.md` for full pipeline details.

## Critical Configuration

### Service Call Format
```yaml
# USE (modern format)
action: "light.turn_on"

# DEPRECATED
domain: light
service: turn_on
```

### Node-RED Standards
- **HA Server**: Always use `79544c2b.6ccc64`
- **Node Versions**: state-changed v6, api-call-service v7, api-current-state v3
- **httpNodeRoot**: `/endpoint/` (auto-prepended — http-in URLs omit this prefix)

### Global Context Keys (Registries)
- `scheduleRegistry` — All schedule definitions + metadata
- `presenceRegistry` — All presence area configurations
- `cachedStates` — Home/away entity state snapshots
- `rollbackStack` — Scene undo entry (LIFO, depth=1)
- `rollbackLog` — Scene undo audit trail (ring buffer, max 20)
- `staticStates` — Namespace-aware entity state overrides
- `staticBlacklist` — Namespace-aware entity blacklists

### InfluxDB Data Types
- **Booleans**: Convert to integers (0/1) via `safeBooleanAsInt()`
- **Objects**: Convert to counts or JSON strings
- **Strings**: Use `safeString()` for proper encoding
- **Numbers**: Use `safeNumber()` to handle null/undefined

## Blacklisted Entities

Global blacklist (excluded from presence, cache-states, scheduling):
```typescript
[
  "son_of_toast",              // Tesla vehicle
  /.*grow.*/i,                 // Grow lights (scheduled separately)
  /.*blinds.*/i,               // Window covers (scheduled separately)
  /.*air_purifier.*/i,         // Air quality
  "switch.washing_machine",
  "switch.dryer",
  /espresense_.*/i,            // Presence sensors
  /.*sonos_beam.*/i            // Speakers
]
```

Namespace blacklist `"presence"` — presence-tracked entities (registered by `seed-registry.ts`). Excluded from schedule enforcement and cache restoration.

## File References

- **System Docs**: `docs/` (scheduling, presence, cache, plants, API, flows, build)
- **Node-RED Automation**: `node-red-scripts/CLAUDE.md`
- **Build System**: `node-red-scripts/build/README.md`
- **Handoff Notes**: `node-red-scripts/HANDOFF.md`
- **State Machine Plan**: `STATE_MACHINE.md`
- **Energy Reference**: `ENERGY.md`
- **Custom Components**: `custom_components/CLAUDE.md`

## Common Queries

```bash
# Schedule API
curl -s http://homeassistant.local:1880/endpoint/schedules/ | python3 -m json.tool
curl -s http://homeassistant.local:1880/endpoint/schedule-status | python3 -m json.tool

# Presence API
curl -s http://homeassistant.local:1880/endpoint/presence/ | python3 -m json.tool

# HA Sensors
curl -s http://homeassistant.local:8123/api/states/sensor.active_schedule_count \
  -H "Authorization: Bearer $HA_TOKEN" | python3 -m json.tool
```

```sql
-- InfluxDB: Recent presence events
SELECT time, presence_state, previous_state, action
FROM nodered.presence_events
WHERE topic =~ /bathroom/ AND time > now() - 1h

-- Schedule activity
SELECT active_schedule_names, actions_generated
FROM nodered.schedule_events
WHERE time > now() - 24h
```

---

**Last Updated**: 2026-02-26
**Git Branch**: master
**Total Source Files**: 88 TypeScript (~11.5K LOC) + 37 YAML configs
