# REST API Reference

All endpoints served by Node-RED at `http://homeassistant.local:1880/endpoint/`.

## Schedule Endpoints

### List Schedules
```
GET /endpoint/schedules/
```
```json
{
  "schedules": [{
    "name": "plants_global",
    "source": "static",
    "enabled": true,
    "type": "continuous",
    "precedence": 100,
    "start": "06:00",
    "end": "23:00",
    "active": true,
    "progress": 0.65,
    "matchedEntityCount": 26
  }],
  "summary": { "total": 13, "active": 6, "static": 13, "dynamic": 0 }
}
```

### Get Schedule
```
GET /endpoint/schedules/:name
```
Returns single schedule with `matchedEntityIds` array.

### Create Schedule (dynamic only)
```
POST /endpoint/schedules/
Content-Type: application/json

{
  "name": "my_schedule",
  "type": "trigger",
  "start": "08:00",
  "end": "17:00",
  "precedence": 50,
  "entities": ["light.kitchen_pendants"]
}
```
Returns 201. Validation: name `^[a-z][a-z0-9_]*$`, unique, precedence 0-1000.

### Update Schedule
```
PUT /endpoint/schedules/:name
```
Static schedules: only `enabled`, `precedence`, `conditions` mutable. Dynamic: all fields.

### Delete Schedule
```
DELETE /endpoint/schedules/:name
```
Returns 403 for static schedules (use PUT to disable).

### Schedule Status (aggregate)
```
GET /endpoint/schedule-status
```
```json
{
  "activeSchedules": [{ "name": "plants_global", "progress": 0.65, "phase": "active" }],
  "pendingTriggers": [{ "name": "blinds_day", "nextFireAt": "17:30" }],
  "inactiveSchedules": [{ "name": "night_auto_lock", "reason": "condition_not_met" }],
  "summary": { "total": 13, "active": 6, "pending": 1, "inactive": 6 }
}
```

## Presence Endpoints

### List Areas
```
GET /endpoint/presence/
```
```json
{
  "areas": [{
    "topic": "guest_bathroom",
    "sensors": ["binary_sensor.guest_bathroom_motion_sensor"],
    "entities": [],
    "coolDown": 600,
    "enabled": true,
    "currentState": { "state": "off", "inCooldown": false }
  }],
  "summary": { "total": 9, "enabled": 9, "occupied": 2 }
}
```

### Area Status
```
GET /endpoint/presence/:topic/status
```
Returns full flow state: `flowInfo`, `runtime` (cooldown remaining, dwell), `sensorStates`, `debounce`.

**Known issue**: Returns empty `flowInfo` because per-room state is in subflow-instance flow context, not global.

### Configure Area
```
POST /endpoint/presence/
Content-Type: application/json

{
  "topic": "new_room",
  "sensors": ["binary_sensor.new_room_motion"],
  "entities": [{ "entity_id": "light.new_room" }],
  "coolDown": 600
}
```

## Other Endpoints

### Scene Cache (Rollback Push)
```
POST /endpoint/scene-cache/
```
Called by the `scene_rollback` custom component on every `scene.turn_on`. Receives pre-scene entity states.

### Remote Entity Control
```
POST /endpoint/remote/
```
IR/RF command dispatch for template lights/fans.

### Domain Entities
```
GET /endpoint/entities/
```
Filtered entity listing by domain.

## Testing

```bash
# Schedule API
curl -s http://homeassistant.local:1880/endpoint/schedules/ | python3 -m json.tool
curl -s http://homeassistant.local:1880/endpoint/schedules/plants_global | python3 -m json.tool
curl -s http://homeassistant.local:1880/endpoint/schedule-status | python3 -m json.tool

# Presence API
curl -s http://homeassistant.local:1880/endpoint/presence/ | python3 -m json.tool
curl -s http://homeassistant.local:1880/endpoint/presence/guest_bathroom/status | python3 -m json.tool

# Create dynamic schedule
curl -X POST http://homeassistant.local:1880/endpoint/schedules/ \
  -H "Content-Type: application/json" \
  -d '{"name":"test_schedule","type":"trigger","start":"08:00","end":"17:00","precedence":50,"entities":["light.kitchen_pendants"]}'

# Delete dynamic schedule
curl -X DELETE http://homeassistant.local:1880/endpoint/schedules/test_schedule

# HA Sensors
curl -s http://homeassistant.local:8123/api/states/sensor.schedule_plants_global_status \
  -H "Authorization: Bearer $HA_TOKEN" | python3 -m json.tool
```
