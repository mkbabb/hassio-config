# Unified Scheduling State Machine Architecture

## Context

Three independent systems — **scheduling**, **presence detection**, and **cache states** — share overlapping concerns but are currently opaque: presence cooldowns live only in Node-RED flow context, schedule evaluation state is half-logged to InfluxDB, and cache operations are fire-and-forget. The core problem is **transparency** — not the logic itself (which is battle-tested), but the inability to observe, introspect, and control these systems from a unified surface.

This plan creates a **registry + state publishing** architecture that makes all system state visible as HA entities while keeping the proven TypeScript/Node-RED runtime. The scheduling engine (12 schedules, precedence resolution, continuous/trigger modes, interpolation) becomes the backbone. Presence areas become fully data-driven (sensors, tracked entities, cooldown — all configurable via API). Cache state transitions gain observability.

### Why TypeScript/Node-RED (not Python)

- **7693 LOC** of battle-tested logic stays intact — zero rewrite risk
- HA REST API `POST /api/states/` creates real HA entities at ~2-5ms/call on localhost
- Publishing ~30 sensors per evaluation cycle = <150ms total overhead
- Action deduplication already exists at 3 layers: `determineEntityAction()` (skip if already in target state), `groupActions()` (consolidate entity_ids), `action-node.ts` (deepEqual before execution)
- The esbuild → Node-RED hot-reload pipeline is production-grade

### Delivery Strategy (Incremental)

**Delivery 1**: Phase 1 (registry refactor) — verify zero behavioral change ✅ COMPLETE
**Delivery 2**: Phase 2 (REST API) — verify CRUD works ✅ COMPLETE
**Delivery 3**: Phases 3-5 (state publishing + presence registry + dashboard) ✅ COMPLETE
**Delivery 4**: Phase 6 (dashboard refinement + CRUD editing + HACS cards) — IN PROGRESS

---

## Phase 1: Schedule Registry (Internal Refactor)

**Goal**: Move schedule definitions from compile-time constants to a runtime registry. Zero behavioral change.

### 1a. Extend types

**File**: `src/scheduling/types.ts` — add below existing `ScheduleEvent` type

```typescript
export type ScheduleSource = "static" | "dynamic";

export interface RegistrySchedule extends Schedule {
    source: ScheduleSource;
    enabled: boolean;
    createdAt: string;          // ISO 8601
    updatedAt: string;
    helperEntities?: string[];  // input_datetime entities created for dynamic schedules
}

export interface ScheduleRegistry {
    version: number;            // schema version for future migrations
    schedules: Record<string, RegistrySchedule>;
    tagDefinitions: Record<string, string[]>;
    lastSeeded: string | null;
}
```

### 1b. Seed registry on startup

**File**: `src/scheduling/schedule/schedules/index.ts` — replace the 34-line file

The existing code does `flow.set("schedules", schedules)`. Replace with registry seeding that:
- On first run: creates registry from all static schedule arrays
- On subsequent runs: idempotently upserts static schedules, preserves dynamic schedules and `enabled` toggles
- Always updates `tagDefinitions` and `lastSeeded`

### 1c. Read from registry in the schedule engine

**File**: `src/scheduling/schedule/index.ts` — change lines 190-192

```typescript
// Before (line 190-192):
const schedules: Schedule[] = flow.get("schedules") ?? [];
const tagDefinitions = flow.get("tagDefinitions") ?? {};

// After:
const registry: ScheduleRegistry = flow.get("scheduleRegistry") ?? { version: 1, schedules: {}, tagDefinitions: {}, lastSeeded: null };
const schedules: Schedule[] = Object.values(registry.schedules).filter(s => s.enabled);
const tagDefinitions = registry.tagDefinitions;
```

Everything downstream is unchanged — `RegistrySchedule extends Schedule`.

### Changes

| File | Change | Lines |
|------|--------|-------|
| `src/scheduling/types.ts` | Add registry types | +15 |
| `src/scheduling/schedule/schedules/index.ts` | Rewrite to registry seeding | ~30 (replace 34) |
| `src/scheduling/schedule/index.ts` | Read from registry | 3 changed |

### Verification
- Build + deploy. InfluxDB `schedule_events` must show identical `active_schedule_names`.
- Node-RED debug: `flow.get("scheduleRegistry")` shows all 12 schedules with `source: "static"`.

---

## Phase 2: REST API (Schedule CRUD + Status)

**Goal**: HTTP endpoints for schedule introspection and management.

### New directory: `src/scheduling/api/`

| File | Role | Endpoint |
|------|------|----------|
| `registry.ts` | Shared read/write utilities | (imported, not a node) |
| `validation.ts` | Schema validation | (imported, not a node) |
| `list-schedules.ts` | List all schedules with runtime state | GET /endpoint/schedules/ |
| `get-schedule.ts` | Single schedule detail + matched entities | GET /endpoint/schedules/:name |
| `create-schedule.ts` | Create dynamic schedule | POST /endpoint/schedules/ |
| `update-schedule.ts` | Modify schedule (static: enabled/precedence only) | PUT /endpoint/schedules/:name |
| `delete-schedule.ts` | Remove dynamic schedule | DELETE /endpoint/schedules/:name |
| `schedule-status.ts` | Aggregate runtime overview | GET /endpoint/schedules/status |

### Response shapes

**GET /endpoint/schedules/**: Full list with resolved times, active flag, source
```json
{
  "schedules": [{
    "name": "plants_global", "source": "static", "enabled": true,
    "type": "continuous", "precedence": 100,
    "start": "06:00", "end": "23:00",
    "startEntity": "input_datetime.plants_global_schedule_start",
    "active": true, "progress": 0.65,
    "conditions": [], "entities": ["regex:(switch|light)\\.(.*grow.*)"]
  }],
  "summary": { "total": 14, "active": 6, "static": 12, "dynamic": 2 }
}
```

**GET /endpoint/schedules/status**: Aggregate runtime snapshot
```json
{
  "currentTime": "14:30",
  "activeSchedules": [
    { "name": "plants_global", "progress": 0.65, "phase": "active" }
  ],
  "pendingTriggers": [
    { "name": "blinds_day", "nextFireAt": "17:30" }
  ],
  "lastEvaluation": "2026-02-22T14:29:55"
}
```

### Validation (`validation.ts`)
- `name`: required, `^[a-z][a-z0-9_]*$`, unique
- `start`: required, `"HH:MM"` string or `{ entity_id: "input_datetime.*" | "sensor.*" }`
- `precedence`: required, 0-1000
- `type`: "continuous" | "trigger"
- `entities`: array of string IDs, `"regex:..."` patterns, or EntityConfig objects
- `conditions`: array of `{ type: "presence"|"state", value, entity_id? }`
- Static schedules: PUT only allows `enabled`, `precedence`, `conditions`

### Helper entity creation

When POST body includes `createHelperEntities: true`, the API creates `input_datetime` entities via HA Config API:
```
POST /api/config/input_datetime/input_datetime/create_item
{ "name": "Schedule X Start", "has_date": false, "has_time": true }
```

### Node-RED wiring
One new flow tab "Schedule API" with 6 endpoint chains:
```
[http-in: GET /endpoint/schedules/]       → [function: list-schedules]   → [http-response]
[http-in: GET /endpoint/schedules/:name]  → [function: get-schedule]     → [http-response]
[http-in: POST /endpoint/schedules/]      → [function: create-schedule]  → [http-response]
[http-in: PUT /endpoint/schedules/:name]  → [function: update-schedule]  → [http-response]
[http-in: DELETE /endpoint/schedules/:name] → [function: delete-schedule] → [http-response]
[http-in: GET /endpoint/schedules/status] → [function: schedule-status]  → [http-response]
```

### Related endpoints (existing, not part of this API)

The following endpoints already exist and are documented here for completeness:
- `POST /endpoint/remote/` — IR/RF remote entity control (see `src/remote-entities/`)
- `POST /endpoint/scene-cache/` — Scene rollback pre-capture (see `src/cache-states/rollback-push.ts`), called by the `scene_rollback` custom component on every `scene.turn_on`

These endpoints remain independent — they serve different purposes (event receivers, not CRUD) and have different callers (HA components, not users/dashboards).

### Changes
- 8 new TypeScript files (~800 LOC)
- `rest_commands.yaml`: add `schedule_api` entry
- Node-RED: 1 new flow, 18 nodes

### Verification
- `curl GET localhost:1880/endpoint/schedules/` returns all 12+ schedules
- `curl POST` creates a dynamic schedule visible in next engine evaluation
- `curl DELETE` removes it; static deletion returns 403

---

## Phase 3: Transparency Layer (State Publishing)

**Goal**: All system state — schedules, presence, cache — published as HA sensor entities. The opaque becomes observable.

### 3a. Schedule state publisher

**New file**: `src/scheduling/publish-schedule-state.ts`

Wired **after** the schedule engine output node. Receives `msg.scheduleEvents`, `msg.debug`, and the registry. For each schedule, calls:

```
POST http://homeassistant.local:8123/api/states/sensor.schedule_{name}_status
Authorization: Bearer ${HA_TOKEN}
```

**Published sensors** (per schedule):

| Entity | State | Key Attributes |
|--------|-------|---------------|
| `sensor.schedule_{name}_status` | active / inactive / ramp_up / ramp_down | `t`, `phase`, `start_time`, `end_time`, `type`, `precedence`, `matched_entity_count`, `conditions_met` |
| `sensor.schedule_{name}_progress` | float 0-1 | `unit_of_measurement: ""` (for gauge cards) |

**Aggregate sensors**:

| Entity | State | Attributes |
|--------|-------|------------|
| `sensor.active_schedule_count` | integer | `active_names` (comma-separated) |
| `sensor.schedule_engine_last_run` | ISO timestamp | `schedules_evaluated`, `actions_generated`, `actions_skipped`, `duration_ms` |

**Batching**: All sensor updates are prepared in the function node as an array. A downstream `split → api-call-service → join` chain executes them. At ~2-5ms per call, 30 sensors = ~100ms.

**Deduplication**: The function node compares proposed sensor state against the last-published state (stored in flow context). Only changed sensors are published. This prevents unnecessary HA state_changed events.

### 3b. Presence state publisher

**New file**: `src/presence/publish-presence-state.ts`

Wired after the presence state machine output. For each topic/room:

| Entity | State | Key Attributes |
|--------|-------|---------------|
| `sensor.presence_{topic}_state` | on / off / pending_off / unknown | `dwell_minutes`, `cooldown_remaining_min`, `cooldown_total_min`, `sensor_count`, `sensors_on`, `last_on`, `last_off`, `trigger_sensor`, `trigger_state` |
| `sensor.presence_{topic}_cooldown` | float (minutes remaining) | `end_time`, `total_seconds`, `dwell_based` (whether dynamic cooldown applied) |

**Deduplication**: Same as 3a — only publish changed state. Presence state changes are event-driven (sensor triggers), not polled, so this naturally limits publish frequency.

### 3c. Cache state publisher

**New file**: `src/cache-states/publish-cache-state.ts`

Wired after the cache state machine (home-status.ts debouncer output).

| Entity | State | Key Attributes |
|--------|-------|---------------|
| `sensor.cache_state_status` | home / away / transitioning | `cached_entity_count`, `last_snapshot`, `last_restore`, `transition_direction` |
| `sensor.cache_state_last_operation` | snapshot / restore / rollback | `entity_count`, `timestamp`, `scene_ids` (for rollback) |

### 3d. Scene rollback state publisher

The existing rollback system (`rollback-push.ts`, `rollback-pop.ts`) stores state in Node-RED global context (`rollbackStack`, `rollbackLog`) which is currently invisible to HA. Add state publishing on both paths:

**Modification**: Wire a lightweight publisher after `rollback-push.ts` and `rollback-pop.ts` outputs (before influx logger). This can be a single new function node or inline additions to the existing push/pop functions.

| Entity | State | Key Attributes |
|--------|-------|---------------|
| `sensor.scene_rollback_status` | available / empty | `scene_ids`, `entity_count`, `captured_at` (ISO), `age_minutes` |

- **On push**: state = "available", attributes populated from the captured entry
- **On pop**: state = "empty", attributes cleared
- **On Node-RED restart**: state = "empty" (global context resets)

This sensor enables:
- Dashboard "Undo Scene" button visibility (only show when state = "available")
- Dashboard display of which scene(s) can be undone and how many entities are involved
- History tracking of scene activations over time via HA state history

**Deduplication**: Push events happen at most once per scene activation (not polled). Pop is user-triggered. No batching needed — single sensor update per event.

**No changes to rollback logic itself** — push/pop/influx-logger remain unchanged. Only the publishing of one additional HA sensor state is added.

### 3e. Template sensors (Jinja fallbacks)

**File**: `template_entities.yaml` — add ~20 lines

```yaml
- sensor:
  - name: "Active Schedule Count"
    unique_id: active_schedule_count_template
    state: >
      {% set ns = namespace(n=0) %}
      {% for s in states.sensor if s.entity_id.startswith('sensor.schedule_')
         and s.entity_id.endswith('_status')
         and s.state in ['active', 'ramp_up', 'ramp_down'] %}
        {% set ns.n = ns.n + 1 %}
      {% endfor %}
      {{ ns.n }}
    icon: mdi:calendar-clock
```

### Changes
- 3 new TypeScript files (~250 LOC) + minor additions to rollback push/pop paths
- `template_entities.yaml`: +20 lines
- Node-RED: wire 3-4 new function nodes into existing flows (no new flows needed — they attach to existing outputs)

---

## Phase 4: Data-Driven Presence Areas

**Goal**: Presence area definitions (sensors, tracked entities, cooldown config) move from hardcoded Node-RED flow wiring to a runtime registry. The presence DFA logic itself is unchanged.

### 4a. Presence registry types

**File**: `src/presence/types.ts` (new file)

```typescript
export interface PresenceAreaConfig {
    topic: string;                          // Room identifier (e.g., "guest_bathroom")
    sensors: string[];                      // Entity IDs that detect presence
    entities: PresenceTrackedEntity[];      // What to control
    coolDown: number;                       // Base cooldown in seconds (default 600)
    enabled: boolean;
    createdAt: string;
    updatedAt: string;
}

export interface PresenceTrackedEntity {
    entity_id: string;
    states?: {
        on?: EntityState;                   // Custom "on" behavior (default: turn_on)
        off?: EntityState;                  // Custom "off" behavior (default: turn_off)
    };
}

export interface PresenceRegistry {
    version: number;
    areas: Record<string, PresenceAreaConfig>;
    lastSeeded: string | null;
}
```

### 4b. Seed presence registry

**New file**: `src/presence/seed-registry.ts`

A function node that runs once on deploy. Seeds the `presenceRegistry` flow context from a static definition of current rooms (extracted from existing Node-RED flow wiring):

```typescript
const STATIC_AREAS: PresenceAreaConfig[] = [
    {
        topic: "guest_bathroom",
        sensors: ["binary_sensor.guest_bathroom_motion_sensor_occupancy"],
        entities: [{ entity_id: "light.guest_bathroom_light" }],
        coolDown: 600, enabled: true, ...
    },
    {
        topic: "downstairs_bathroom",
        sensors: ["binary_sensor.downstairs_bathroom_motion"],
        entities: [{ entity_id: "light.downstairs_bathroom_light" }],
        coolDown: 600, enabled: true, ...
    },
    // ... all current rooms
];
```

Same idempotent upsert pattern as the schedule registry.

### 4c. Modify presence.ts to read from registry

**File**: `src/presence/presence.ts` — modify the entity/config loading section

Currently, `msg.entities` and `msg.topic` are set by upstream Node-RED wiring (each room has its own state-changed node). With the registry:

1. The state-changed trigger node fires for **any** presence sensor (using a broad entity filter)
2. The function node looks up which area the triggering sensor belongs to via the registry
3. Entities and cooldown config come from the registry, not `msg`

```typescript
// Instead of:
const rawEntities = message.entities;
const topic = message.topic;
const coolDown = message.coolDown || DEFAULT_COOL_DOWN;

// Now:
const registry: PresenceRegistry = flow.get("presenceRegistry");
const triggerEntityId = message.data?.entity_id;

// Find which area this sensor belongs to
const area = Object.values(registry.areas).find(a =>
    a.enabled && a.sensors.includes(triggerEntityId)
);
if (!area) return; // Sensor not in any area

const topic = area.topic;
const entities = area.entities;
const coolDown = area.coolDown;
```

This is the largest behavioral change in the plan. The DFA logic (state transitions, cooldown calculation, debouncing, pathological sequence detection) remains **100% unchanged**. Only the input source changes.

### 4d. Simplify Node-RED flow wiring

Currently, each room requires:
- 1 state-changed node (specific sensor)
- 1 function node (presence.ts) with room-specific msg properties
- 1 trigger node (cooldown delay)
- 1 function node (get-flow-info)
- Service call nodes

With data-driven areas:
- **1 state-changed node** with broad filter (all motion/occupancy sensors)
- **1 function node** (presence.ts) that reads the registry
- 1 trigger node (same)
- 1 function node (get-flow-info, same)
- Service call nodes (same)

This collapses N parallel room chains into 1 generic chain. The registry tells presence.ts which room was triggered and what to control.

### 4e. Presence API endpoints

| File | Endpoint | Purpose |
|------|----------|---------|
| `src/presence/api/list-areas.ts` | GET /endpoint/presence/ | All area configs + current states |
| `src/presence/api/area-status.ts` | GET /endpoint/presence/:topic/status | Full flow state for one area |
| `src/presence/api/configure-area.ts` | POST /endpoint/presence/ | Create/update area config |

**GET /endpoint/presence/** response:
```json
{
  "areas": [{
    "topic": "guest_bathroom",
    "sensors": ["binary_sensor.guest_bathroom_motion_sensor_occupancy"],
    "entities": [{ "entity_id": "light.guest_bathroom_light" }],
    "coolDown": 600, "enabled": true,
    "currentState": {
      "state": "off",
      "lastOn": "2026-02-22T14:20:00",
      "lastOff": "2026-02-22T14:25:00",
      "inCooldown": false
    }
  }]
}
```

**GET /endpoint/presence/:topic/status** response:
```json
{
  "topic": "guest_bathroom",
  "state": "pending_off",
  "flowInfo": {
    "state": "pending_off", "prevState": "on",
    "lastOn": 1740249600000, "lastOff": 1740249900000,
    "delay": 720000, "coolDownEndTime": 1740250620000
  },
  "sensorStates": { "binary_sensor.guest_bathroom_motion": "off" }
}
```

### Changes

| File | Change | Lines |
|------|--------|-------|
| `src/presence/types.ts` | New: area config types | ~40 |
| `src/presence/seed-registry.ts` | New: static area definitions + seeding | ~80 |
| `src/presence/presence.ts` | Modify: read from registry instead of msg | ~20 changed |
| `src/presence/api/list-areas.ts` | New: REST endpoint | ~60 |
| `src/presence/api/area-status.ts` | New: REST endpoint | ~50 |
| `src/presence/api/configure-area.ts` | New: REST endpoint | ~80 |
| Node-RED flows | Collapse N room chains → 1 generic chain | Simplification |

---

## Phase 5: Dashboard UI

**Goal**: New "Schedules" Lovelace view. Monitoring-first, with architecture ready for future CRUD.

### 5a. View layout

Path: `schedules` | Icon: `mdi:calendar-clock` | Theme: `ios-dark-mode-blue-red` | Layout: masonry

**Badges**: `input_boolean.schedule_pause`, `input_select.day_status`, `input_select.home_status`

**Card sections**:

1. **Status header** — Mushroom template: active schedule count, last engine run
2. **Day/Night** — Mushroom + gauge (progress with sunrise/sunset phase colors) + weekday/weekend time pickers via auto-entities
3. **Plant schedules** — Vertical stack per schedule: Mushroom header + conditional gauge + input_datetime pickers
4. **Blinds/Locks** — Trigger cards (no gauge, show last-triggered via attributes)
5. **Presence areas** — Per-room Mushroom card: state icon (motion/timer/off) + dwell/cooldown display + sensor list + tracked entity list
6. **Cache & Rollback status** — Two cards:
   - Cache: Mushroom card showing home/away/transitioning + cached entity count + last operation
   - Scene Rollback: Conditional card (visible only when `sensor.scene_rollback_status` = "available") showing scene name(s), entity count, age, and "Undo Scene" button that toggles `input_boolean.scene_rollback`
7. **Timeline** — history-graph: `sensor.schedule_*_status` over 24h (state-colored horizontal bars)
8. **Controls** — entities card: schedule_pause, presence_pause, plants_trigger_on/off

### 5b. Schedule card pattern (reusable)

```yaml
type: vertical-stack
cards:
  - type: custom:mushroom-template-card
    primary: "Plants Global"
    secondary: >-
      {{ state_attr('sensor.schedule_plants_global_status', 'start_time') }}
      - {{ state_attr('sensor.schedule_plants_global_status', 'end_time') }}
      {% if is_state('sensor.schedule_plants_global_status', 'active') %}
        | {{ (state_attr('sensor.schedule_plants_global_status', 't') | float * 100) | round(0) }}%
      {% endif %}
    icon: mdi:leaf
    icon_color: >-
      {% if is_state('sensor.schedule_plants_global_status', 'active') %}green
      {% elif is_state('sensor.schedule_plants_global_status', 'ramp_up') %}amber
      {% else %}grey{% endif %}
    layout: horizontal
    fill_container: true
  - type: conditional
    conditions:
      - condition: state
        entity: sensor.schedule_plants_global_status
        state_not: "inactive"
    card:
      type: gauge
      entity: sensor.schedule_plants_global_progress
      min: 0
      max: 1
      needle: true
  - type: entities
    entities:
      - entity: input_datetime.plants_global_schedule_start
        name: Start
        icon: mdi:clock-start
      - entity: input_datetime.plants_global_schedule_end
        name: End
        icon: mdi:clock-end
```

### 5c. Presence area card pattern

```yaml
type: vertical-stack
cards:
  - type: custom:mushroom-template-card
    primary: "Guest Bathroom"
    secondary: >-
      {% set s = states('sensor.presence_guest_bathroom_state') %}
      {% if s == 'on' %}
        Occupied ({{ state_attr('sensor.presence_guest_bathroom_state', 'dwell_minutes') | round(0) }}min)
      {% elif s == 'pending_off' %}
        Cooldown: {{ state_attr('sensor.presence_guest_bathroom_cooldown', 'remaining_min') | round(1) }}min
      {% else %}Vacant{% endif %}
    icon: >-
      {% set s = states('sensor.presence_guest_bathroom_state') %}
      {% if s == 'on' %}mdi:motion-sensor
      {% elif s == 'pending_off' %}mdi:timer-sand
      {% else %}mdi:motion-sensor-off{% endif %}
    icon_color: >-
      {% set s = states('sensor.presence_guest_bathroom_state') %}
      {% if s == 'on' %}green{% elif s == 'pending_off' %}amber{% else %}grey{% endif %}
    layout: horizontal
  - type: entities
    entities:
      - entity: binary_sensor.guest_bathroom_motion_sensor_occupancy
        name: Motion Sensor
        state_color: true
      - entity: light.guest_bathroom_light
        name: Tracked Light
        state_color: true
```

### 5d. Scene rollback card pattern

```yaml
type: conditional
conditions:
  - condition: state
    entity: sensor.scene_rollback_status
    state: "available"
card:
  type: vertical-stack
  cards:
    - type: custom:mushroom-template-card
      primary: "Undo Scene"
      secondary: >-
        {{ state_attr('sensor.scene_rollback_status', 'scene_ids') }}
        ({{ state_attr('sensor.scene_rollback_status', 'entity_count') }} entities,
        {{ state_attr('sensor.scene_rollback_status', 'age_minutes') | round(0) }}min ago)
      icon: mdi:undo-variant
      icon_color: orange
      layout: horizontal
      tap_action:
        action: call-service
        service: input_boolean.turn_on
        target:
          entity_id: input_boolean.scene_rollback
```

### 5e. Future CRUD architecture (not built now, but designed for)

When ready to add dashboard CRUD:
- Mushroom chips card with "Add Schedule" button → calls `rest_command.schedule_api` with create payload
- Entity card with overflow menu → edit/delete via `rest_command` calls
- Custom:auto-entities dynamically lists schedules from `sensor.schedule_*_status` entities (no hardcoding)

### Changes
- `.storage/lovelace`: add new view (dashboard YAML)
- No TypeScript changes in this phase

---

## Summary

### Total impact

| Metric | Count |
|--------|-------|
| New TypeScript files | ~18 |
| New LOC | ~1500 |
| Modified existing TS files | 4 (types.ts, schedules/index.ts, schedule/index.ts, presence.ts) |
| Lines changed in existing files | ~60 |
| New Node-RED flows | 2 (Schedule API, Presence API) |
| New Node-RED nodes | ~30 (endpoint chains + publishers) |
| Collapsed Node-RED nodes | ~N×5 per room (replaced by 1 generic chain) |
| New HA sensors | ~32 (12 schedule status + 12 progress + ~6 presence + cache + rollback + aggregates) |

### Published sensor inventory (the transparency surface)

| Sensor Pattern | Source | Update Trigger |
|----------------|--------|---------------|
| `sensor.schedule_{name}_status` | Schedule engine | Every evaluation cycle (1-5 min) |
| `sensor.schedule_{name}_progress` | Schedule engine | Every evaluation cycle |
| `sensor.active_schedule_count` | Schedule engine | Every evaluation cycle |
| `sensor.schedule_engine_last_run` | Schedule engine | Every evaluation cycle |
| `sensor.presence_{topic}_state` | Presence DFA | On sensor state change |
| `sensor.presence_{topic}_cooldown` | Presence DFA | On sensor state change |
| `sensor.cache_state_status` | Cache system | On home_status change |
| `sensor.cache_state_last_operation` | Cache system | On cache operation |
| `sensor.scene_rollback_status` | Rollback push/pop | On scene activation or rollback trigger |

### Delivery schedule

1. **Delivery 1** (Phase 1): Registry refactor — 3 files changed, verify zero behavioral change
2. **Delivery 2** (Phase 2): REST API — 8 new files, verify CRUD works via curl
3. **Delivery 3** (Phases 3-5): State publishing + data-driven presence + dashboard — the full transparency layer

### Verification

| Phase | Test |
|-------|------|
| 1 | InfluxDB `schedule_events.active_schedule_names` identical before/after |
| 2 | `curl GET /endpoint/schedules/` returns 12 schedules; POST creates dynamic schedule |
| 3 | HA Developer Tools → States shows `sensor.schedule_*` entities updating |
| 4 | `curl GET /endpoint/presence/` returns area configs; presence still works per-room |
| 5 | Dashboard "Schedules" view shows live progress, presence state, cache status, rollback availability |

---

## Design Notes

### Scene rollback ↔ schedule interaction

Scene activations operate **outside** the schedule engine — they are user-initiated events, not time-window evaluations. This creates a known interaction:

- If a user activates a scene during an active **continuous** schedule, the schedule engine may re-enforce its target state on the next evaluation cycle (1-5 min), effectively overriding the scene.
- If the user later triggers a rollback, the restored pre-scene state may already match what the schedule enforces — making the rollback a no-op.
- **Trigger** schedules are unaffected (they only fire once at start/end).

This is expected behavior, not a bug. The existing `input_boolean.schedule_pause` provides an escape hatch if the user wants to activate a scene without schedule interference.

### Rollback system independence

The scene rollback system (`rollback-push.ts`, `rollback-pop.ts`, `rollback-influx-logger.ts`) and the cache-states system (`cache-house-state.ts`, `merge-cached-states.ts`, etc.) use **separate storage**:
- Cache: `global.get("cachedStates")` — home/away state snapshots
- Rollback: `global.get("rollbackStack")` / `global.get("rollbackLog")` — scene undo

They share utility functions (`createServiceCall`, `filterBlacklistedEntity`, `groupActions`, `serviceToActionCall`) from `src/cache-states/utils.ts` and `src/utils/`. This is code reuse, not coupling. The rollback system does not modify `cachedStates`, and the cache system does not read `rollbackStack`.

### Deduplication guarantees

Action deduplication is maintained at three existing layers — no new dedup logic needed:

1. **Schedule engine** (`state-mapping.ts:determineEntityAction`): Returns `null` if entity already in target state
2. **Action grouping** (`service-calls.ts:groupActions`): Consolidates identical actions across entities into single API calls
3. **Smart filter** (`cache-states/action-node.ts`): `deepEqual()` comparison of current vs proposed state before execution

The transparency layer (state publishing) adds its own dedup: only publish sensors whose state actually changed (compared against last-published value in flow context). This prevents HA `state_changed` event spam.

---

## Phase 6: Dashboard Refinement & CRUD Editing *(Delivery 4)*

**Goal**: Address 9 UX gaps in the Phase 5 dashboard. Add inline controls, progress bars, smooth graphs, editable fields, clear-cooldown buttons, and HACS cards.

**Status**: Backend complete ✅ | Dashboard v1 deployed ✅ | HomeKit-style redesign in progress

### 6a. New API: Clear Cooldown ✅

**File**: `src/presence/api/clear-cooldown.ts` (NEW)
**Endpoint**: `POST /endpoint/presence/:topic/clear-cooldown`

Resets active cooldown for a specific presence area:
- Clears `flowInfo.delay` and `flowInfo.coolDownEndTime`
- Transitions `pending_off` → `off` (only sets `lastOff` in this case)
- Returns previous/new state and cleared cooldown duration

**rest_command**: `presence_clear_cooldown` in `rest_commands.yaml`

### 6b. Partial Updates for Presence Areas ✅

**File**: `src/presence/api/configure-area.ts` (MODIFIED)

- `sensors` no longer mandatory for existing areas (preserved from registry)
- `entities` preserved from existing when not provided
- Individual field updates: `coolDown`, `enabled`, `externalOverridePolicy`, `externalOverrideGracePeriod`
- InfluxDB logging metadata on all mutations

### 6c. Static Schedule durationModifier Editing ✅

**File**: `src/scheduling/api/validation.ts` (MODIFIED)
- Added `durationModifier` to `allowedKeys` for static schedules
- Added range validation (0 < durationModifier < 1) in `validateUpdateSchedule`

**File**: `src/scheduling/api/update-schedule.ts` (MODIFIED)
- Applies `durationModifier` for both static and dynamic schedules

### 6d. Guest Bedroom Motion Sensor Re-enabled ✅

**File**: `.storage/core.entity_registry`
- Changed `binary_sensor.guest_bedroom_motion_sensor` from `disabled_by: "user"` to `disabled_by: null`

### 6e. InfluxDB API Mutation Logging ✅

All three API endpoints attach `message.influxLog` metadata for downstream InfluxDB node:
- `update-schedule.ts`: measurement `api_events`, tag `schedule_update`
- `configure-area.ts`: measurement `api_events`, tag `presence_create` / `presence_update`
- `clear-cooldown.ts`: measurement `api_events`, tag `presence_clear_cooldown`

### 6f. Startup-Republish for Presence Sensors ✅

**File**: `src/utils/startup-republish.ts` (MODIFIED)
- Changed to multi-output (outputs: 2)
- Output 1 → schedule engine (existing)
- Output 2 → array of presence messages (Node-RED fans out automatically)
- Clears ephemeral dedup caches for all three publishers

### 6g. Presence Enabled Attribute ✅

**File**: `src/presence/publish-presence-state.ts` (MODIFIED)
- Reads `enabled` from `global.get("presenceRegistry")` per area
- Published as attribute on `sensor.presence_{topic}_state`
- Required for dashboard toggle functionality

### 6h. HACS Cards Installed ✅

Downloaded to `/Volumes/config/www/community/`:
- `mini-graph-card` (122KB) — smooth interpolated line graphs
- `card-mod` (97KB) — CSS injection for progress bars, inline chips
- `stack-in-card` (38KB) — borderless card stacking

Registered in `.storage/lovelace_resources`.

### 6i. Input Helpers for Dashboard Editing ✅

**File**: `input_number.yaml` (NEW) — 10 entities:
- 9 presence cooldown sliders (60-1800s, step 30)
- 1 shelf duration modifier (10-100%, step 5)

**File**: `input_select.yaml` (MODIFIED) — 9 new entries:
- Override policy per area (respect/ignore/extend)

### 6j. Sync Automations ✅

**File**: `automations.yaml` (MODIFIED) — 3 new automations:
- `sync_presence_cooldown_to_api`: input_number → REST API coolDown update
- `sync_override_policy_to_api`: input_select → REST API externalOverridePolicy update
- `sync_shelf_duration_modifier`: input_number → REST API durationModifier update

### 6k. flows.json Wiring ✅

- 9 new nodes for clear-cooldown chain, InfluxDB logging, startup presence republish
- 5 function nodes updated with recompiled JS
- 15 HTTP endpoints total

### 6l. Dashboard Views — v2 HomeKit Redesign 🔄

**Status**: IN PROGRESS

v1 (mushroom cards) deployed. v2 redesign targeting:
- HomeKit-style aesthetic with glassmorphism
- Smooth mini-graph-card line charts
- card-mod CSS progress bar pills
- Inline play/pause via tap_action + badge indicators
- Modal/popup editing for schedule conditions and presence settings
- Section-based layout for schedule types
- Clear-cooldown conditional chips

### Verification

```bash
# 6a - Clear cooldown
curl -X POST http://homeassistant.local:1880/endpoint/presence/bonus_room/clear-cooldown

# 6b - Partial update (just cooldown)
curl -X POST http://homeassistant.local:1880/endpoint/presence/ \
  -H "Content-Type: application/json" \
  -d '{"topic": "bonus_room", "coolDown": 300}'

# 6c - Update durationModifier on static schedule
curl -X PUT http://homeassistant.local:1880/endpoint/schedules/plants_shelf \
  -H "Content-Type: application/json" \
  -d '{"durationModifier": 0.6}'

# 6d - Guest bedroom sensor active after HA restart
# 6e - InfluxDB: SELECT * FROM nodered.api_events WHERE time > now() - 1h
# 6f - All 9 presence sensors publish after NR restart
# 6h - HACS cards load in browser console (no 404s)
# 6i-j - Input helpers sync to API on slider/select change
```
