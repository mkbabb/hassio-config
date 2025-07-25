# Home Assistant Request Interception Patterns

## Service Override Pattern

The most practical approach used by production integrations like Adaptive Lighting. Directly replaces service handlers in the registry:

```python
async def async_setup_entry(hass, config_entry):
    original_service = hass.services._services.get("light", {}).get("turn_on")
    
    async def intercepted_turn_on(service_call):
        # Block chili peppers if bathroom lights are on
        entities = service_call.data.get("entity_id", [])
        bathroom_light = "light.downstairs_bathroom_light"
        chili_pepper = "light.downstairs_bathroom_chili_pepper_lights"
        
        if chili_pepper in entities and hass.states.get(bathroom_light).state == "on":
            entities.remove(chili_pepper)
            _LOGGER.info(f"Blocked {chili_pepper} - bathroom light is on")
        
        if entities:
            await original_service.job.target(
                ServiceCall(
                    domain="light",
                    service="turn_on",
                    data={**service_call.data, "entity_id": entities},
                    context=service_call.context
                )
            )
    
    hass.services.async_register("light", "turn_on", intercepted_turn_on)
```

## Template Entity Wrapper Pattern

Creates proxy entities with built-in conditional logic:

```yaml
light:
  - platform: template
    lights:
      protected_chili_peppers:
        value_template: "{{ states('light.downstairs_bathroom_chili_pepper_lights') }}"
        turn_on:
          - condition: state
            entity_id: light.downstairs_bathroom_light
            state: "off"
          - service: light.turn_on
            target:
              entity_id: light.downstairs_bathroom_chili_pepper_lights
        turn_off:
          - service: light.turn_off
            target:
              entity_id: light.downstairs_bathroom_chili_pepper_lights
```

## Node-RED Middleware Pattern

Leveraging existing TypeScript infrastructure:

```typescript
// utils/conditional-blacklist.ts
interface ConditionalBlock {
  blockedEntity: string;
  condition: string;
  blockWhenState: string;
}

const CONDITIONAL_BLOCKS: ConditionalBlock[] = [
  {
    blockedEntity: "light.downstairs_bathroom_chili_pepper_lights",
    condition: "light.downstairs_bathroom_light",
    blockWhenState: "on"
  },
  {
    blockedEntity: "light.guest_bathroom_peppa_pig_lights",
    condition: "light.guest_bathroom_light",
    blockWhenState: "on"
  }
];

export const shouldBlockEntity = (entityId: string, hass: any): boolean => {
  const block = CONDITIONAL_BLOCKS.find(b => b.blockedEntity === entityId);
  if (!block) return false;
  
  const conditionState = hass.states.get(block.condition);
  return conditionState?.state === block.blockWhenState;
};
```

## Event Bus Monitor Pattern

Non-blocking monitoring and compensating actions:

```python
async def async_setup(hass, config):
    blocked_calls = {}
    
    async def monitor_service_calls(event):
        if event.data.get("domain") != "light":
            return
            
        service_data = event.data.get("service_data", {})
        entities = service_data.get("entity_id", [])
        
        for entity in entities:
            if should_block(entity, hass):
                # Track blocked call for UI notification
                blocked_calls[entity] = time.time()
                
                # Fire custom event
                hass.bus.async_fire("entity_blocked", {
                    "entity_id": entity,
                    "reason": "conditional_block",
                    "blocked_by": get_blocking_entity(entity)
                })
    
    hass.bus.async_listen("call_service", monitor_service_calls)
```

## Custom Component with Registry

Complete solution with configuration:

```python
# custom_components/entity_guard/__init__.py
DOMAIN = "entity_guard"

async def async_setup(hass, config):
    conf = config.get(DOMAIN, {})
    rules = conf.get("rules", [])
    
    # Build rule engine
    guard = EntityGuard(hass, rules)
    
    # Store original services
    for domain in ["light", "switch", "fan"]:
        for service in ["turn_on", "turn_off"]:
            original = hass.services._services.get(domain, {}).get(service)
            if original:
                guard.store_original(domain, service, original)
    
    # Register interceptors
    for domain, service, handler in guard.get_handlers():
        hass.services.async_register(domain, service, handler)
    
    return True

# configuration.yaml
entity_guard:
  rules:
    - entity: light.downstairs_bathroom_chili_pepper_lights
      block_when:
        entity: light.downstairs_bathroom_light
        state: "on"
    - entity: switch.garage_heater
      block_when:
        entity: cover.garage_door
        state: "open"
```

## Performance Considerations

- Service override adds ~1-2ms latency per call
- Template entities update asynchronously (may have slight delay)
- Event monitoring is non-blocking but can't prevent execution
- Node-RED adds network hop if using REST API

## Recommendations

1. **For your use case**: Service Override Pattern provides deepest integration
2. **For maintainability**: Template Entity Pattern requires no custom code
3. **For complex logic**: Node-RED middleware leverages existing TypeScript
4. **For monitoring**: Event Bus pattern provides audit trail without blocking

The service registry manipulation approach, while using internal APIs, is battle-tested by popular integrations and provides the most seamless user experience.