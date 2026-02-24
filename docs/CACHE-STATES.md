# Cache States & Scene Rollback

Two independent systems sharing utility functions but with separate storage:
- **Cache states**: Home/away entity snapshots and restoration
- **Scene rollback**: Undo last scene activation (LIFO stack, depth=1)

## Cache States

### Away Transition

When `input_select.home_status` changes to away (debounced 30s, or immediate if stable 5+ min):

1. Snapshot all entities → `global.get("cachedStates")`
2. **Presence-tracked entities excluded from snapshot** (but included in away payload)
3. Generate away payload:
   - Lights/switches: off
   - Fans: 33%
   - Climate: away preset
   - Locks: locked
   - Covers: closed
4. Execute away payload

### Home Transition

1. Read cached states from `global.get("cachedStates")`
2. Convert to service actions
3. Execute — **only non-presence entities restored**
4. Presence lights wait for natural motion trigger

### Presence Filtering

Five files filter presence-tracked entities using `shouldFilterEntity(entityId, { namespace: "presence" })`:

| File | What's Filtered |
|------|----------------|
| `cache-house-state.ts` | Cached snapshot excludes presence; away payload includes all |
| `filter-blacklisted-entities.ts` | All namespace blacklists applied |
| `merge-cached-states.ts` | Incoming states filtered before merge |
| `merge-scene-cached-states.ts` | Scene states filtered before merge |
| `rollback-push.ts` | Pre-scene capture excludes presence entities |

## Scene Rollback

### Push (scene activated)

The `scene_rollback` custom component sends a POST to `/endpoint/scene-cache/` with pre-scene entity states. `rollback-push.ts` stores them:

```
global.get("rollbackStack") = {
  sceneIds: ["scene.nighttime"],
  serviceCalls: [...],
  entityCount: 42,
  timestamp: 1740249600000
}
```

Plus a ring buffer log (`global.get("rollbackLog")`, max 20 entries).

### Pop (undo triggered)

When `input_boolean.scene_rollback` turns on, `rollback-pop.ts` restores the stored states and clears the stack.

### Published Sensor

`sensor.scene_rollback_status`:
- State: `"available"` (entry exists) or `"empty"` (no entry)
- Attributes: `scene_ids`, `entity_count`, `captured_at`, `age_minutes`

## Files

```
src/cache-states/
├── action-node.ts               (105 LOC) — Smart action filter (skip unchanged)
├── cache-house-state.ts          (46 LOC) — Snapshot + away payload
├── filter-blacklisted-entities.ts (27 LOC) — Global + namespace filtering
├── home-status.ts               (104 LOC) — 5min/30s debouncer
├── influx-logger.ts              (53 LOC) — cache_events measurement
├── merge-cached-states.ts        (26 LOC) — Merge into global store
├── merge-scene-cached-states.ts  (36 LOC) — Scene state merge
├── publish-cache-state.ts        (90 LOC) — Sensor publishing
├── push-cache-states.ts          (30 LOC) — Push states to global store
├── rollback-influx-logger.ts     (36 LOC) — rollback_events measurement
├── rollback-pop.ts               (80 LOC) — Restore + clear stack
├── rollback-push.ts              (99 LOC) — Capture pre-scene state
├── states-to-actions.ts           (9 LOC) — Service call → action format
└── utils.ts                     (237 LOC) — createServiceCall, createAwayPayload, filterAttributes
```

## Global Context Keys

| Key | Type | Purpose |
|-----|------|---------|
| `cachedStates` | `Hass.Service[]` | Home/away state snapshots |
| `rollbackStack` | `RollbackEntry \| null` | Current scene undo entry |
| `rollbackLog` | `RollbackEntry[]` | Ring buffer (max 20) |

## Node-RED Flow Tabs

- **Cache Home 🏡** — home-status debouncer, cache-house-state, merge, publish
- **Day 🌞/Night 🌚** — merge-cached-states, merge-scene-cached-states, action-node
- **Scene Rollback** — rollback-push (HTTP POST), rollback-pop (input_boolean trigger), influx logging
