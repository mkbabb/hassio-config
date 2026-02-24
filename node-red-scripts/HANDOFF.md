# State Machine Architecture — Handoff Notes

## What Shipped

Five-phase "Unified Scheduling State Machine Architecture" — registry + state publishing + REST API + dashboard. All TypeScript compiled, deployed to Node-RED, and publishing HA sensors.

### Phase 1: Schedule Registry
- `RegistrySchedule extends Schedule` with `source`, `enabled`, `createdAt`, `updatedAt`
- `schedules/index.ts` seeds registry idempotently every 10s via `global.set("scheduleRegistry")`
- `schedule/index.ts` reads from registry, filters by `enabled`
- Zero behavioral change — downstream code sees same `Schedule` shape

### Phase 2: Schedule REST API (6 endpoints)
| Method | URL | Handler |
|--------|-----|---------|
| GET | `/endpoint/schedules/` | `scheduling/api/list-schedules.ts` |
| GET | `/endpoint/schedules/:name` | `scheduling/api/get-schedule.ts` |
| POST | `/endpoint/schedules/` | `scheduling/api/create-schedule.ts` |
| PUT | `/endpoint/schedules/:name` | `scheduling/api/update-schedule.ts` |
| DELETE | `/endpoint/schedules/:name` | `scheduling/api/delete-schedule.ts` |
| GET | `/endpoint/schedule-status` | `scheduling/api/schedule-status.ts` |

Note: status uses `/schedule-status` (not `/schedules/status`) to avoid `:name` param conflict.

### Phase 3: State Publishing
- `publish-schedule-state.ts` → 28 sensors (`sensor.schedule_{name}_status`, `_progress`, aggregates)
- `publish-presence-state.ts` → wired but presence sensors only appear after motion triggers
- `publish-cache-state.ts` → wired, fires on home_status changes
- Rollback push/pop → `msg.rollbackSensorUpdate` → format node → `ha-api POST /api/states/`
- Deduplication: compares against last-published state in flow context

### Phase 4: Presence Registry + Cache Filtering
- `seed-registry.ts` → 9 areas in `global.set("presenceRegistry")`
- `presence.ts` → fallback reads from registry if `msg.topic`/`msg.entities` not set
- 3 presence API endpoints (list, status, configure)
- Cache-states modified: `shouldFilterEntity()` with `namespace: "presence"` added to 5 files
- Away payload still turns off presence lights; home restore excludes them

### Phase 5: Dashboard
- Lovelace "Schedules" view at path `schedules` with 10 cards
- URL: `http://homeassistant.local:8123/lovelace/schedules`

## Known Issues & Incomplete Items

### Must Fix
1. **Presence per-room state not visible in API** — `flowInfo.{topic}` and `presenceStates.{topic}` are stored per-subflow-instance flow context. API nodes (now on Presence tab) can't read subflow instance context. Fix: move per-room state to `global.set("presenceFlowInfo.{topic}")` in `presence.ts` and read with `global.get()` in API endpoints.

2. **Presence sensors not publishing** — `publish-presence-state.ts` is wired after `presence.ts` in the Presence Subflow, but presence outputs go through the debounce/get-flow-info chain, not directly to the publisher. Need to verify the publisher actually receives msg after a motion event.

3. **Cache sensors not publishing** — `publish-cache-state.ts` is wired after `home-status.ts`, but needs a natural away→home or home→away transition to fire. Untested in production.

4. **Sensors don't survive HA restart** — Created via `POST /api/states/` (REST API sensors), they vanish when HA restarts and repopulate when Node-RED's timer fires. The dashboard shows "unknown"/"unavailable" for ~30s after HA restart. Not a real problem in practice since HA rarely restarts.

5. **Reset hack not yet removed** — The 10-node presence reset chain on "Presence 🔦" tab still exists. Plan says remove it only after verifying cache filtering works through a full away→home cycle.

### Nice to Have
- `sensor.plant_schedule_duration` referenced in dashboard but doesn't exist yet (template sensor needed)
- Master bathroom presence card doesn't show cooldown minutes (missing `states('sensor.presence_master_bathroom_cooldown')`)
- `new-flow-nodes.json` temp file should be cleaned up
- Node-RED hot-reload API returns 400 — all deploys fall back to file-based + restart

## Architecture Decisions

- **Global context for registries** (`global.get/set`), not `flow.get/set` — because API endpoints and engines live on different flow tabs
- **Flow context for per-room state** — still `flow.get/set` in presence subflow instances (this is correct for the DFA but blocks API access)
- **API nodes on engine tabs** — moved from dedicated API tabs to Scheduler/Presence tabs to share flow context (but the registry is global anyway now, so this was partially unnecessary)
- **Publisher chain**: function → switch (null check) → split → ha-api (POST /api/states/)
- **Rollback sensor chain**: push/pop function → format function (extract `msg.rollbackSensorUpdate`) → ha-api

## File Inventory

### New Files (18)
```
src/scheduling/types.ts              (modified — added registry types)
src/scheduling/api/registry.ts       (shared read/write utils)
src/scheduling/api/validation.ts     (schema validation)
src/scheduling/api/list-schedules.ts
src/scheduling/api/get-schedule.ts
src/scheduling/api/create-schedule.ts
src/scheduling/api/update-schedule.ts
src/scheduling/api/delete-schedule.ts
src/scheduling/api/schedule-status.ts
src/scheduling/publish-schedule-state.ts
src/presence/types.ts
src/presence/seed-registry.ts
src/presence/publish-presence-state.ts
src/presence/api/list-areas.ts
src/presence/api/area-status.ts
src/presence/api/configure-area.ts
src/cache-states/publish-cache-state.ts
template_entities.yaml               (modified — added template sensor)
```

### Modified Files (9)
```
src/scheduling/schedule/schedules/index.ts  (registry seeding)
src/scheduling/schedule/index.ts            (registry read)
src/presence/presence.ts                    (registry fallback)
src/cache-states/cache-house-state.ts       (presence split filtering)
src/cache-states/filter-blacklisted-entities.ts (namespace filter)
src/cache-states/merge-cached-states.ts     (presence filter)
src/cache-states/merge-scene-cached-states.ts (presence filter)
src/cache-states/rollback-push.ts           (sensor update + presence filter)
src/cache-states/rollback-pop.ts            (sensor update + bug fix)
```

### Node-RED Flow Changes
- 46 new nodes added to flows.json (function, http-in, http-response, split, switch, ha-api, inject)
- 5 upstream wiring changes (schedule engine → publisher, presence → publisher, cache → publisher, rollback push/pop → sensor formatter)
- Deploy mappings updated: 48 total (was 35)

## Testing Cheat Sheet
```bash
# Schedule API
curl -s http://homeassistant.local:1880/endpoint/schedules/ | python3 -m json.tool
curl -s http://homeassistant.local:1880/endpoint/schedules/plants_global | python3 -m json.tool
curl -s http://homeassistant.local:1880/endpoint/schedule-status | python3 -m json.tool

# Presence API
curl -s http://homeassistant.local:1880/endpoint/presence/ | python3 -m json.tool
curl -s http://homeassistant.local:1880/endpoint/presence/guest_bathroom/status | python3 -m json.tool

# HA Sensors
curl -s http://homeassistant.local:8123/api/states/sensor.schedule_plants_global_status \
  -H "Authorization: Bearer $HA_TOKEN" | python3 -m json.tool
curl -s http://homeassistant.local:8123/api/states/sensor.active_schedule_count \
  -H "Authorization: Bearer $HA_TOKEN" | python3 -m json.tool

# Build + Deploy
cd /Volumes/config/node-red-scripts
npm run build && npm run deploy:all
```
