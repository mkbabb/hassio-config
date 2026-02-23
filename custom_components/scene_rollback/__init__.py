"""Scene Rollback integration for capturing pre-scene state.

Before a scene is activated (scene.turn_on), this component captures the current
state of all entities that the scene will modify. The captured state is POSTed
to a Node-RED HTTP endpoint which stores it for later rollback.

The interceptor never blocks scene activation -- if the POST fails or times out,
the scene still activates normally.
"""
import asyncio
import logging
from typing import Any

import aiohttp

from homeassistant.core import HomeAssistant, ServiceCall
from homeassistant.config_entries import ConfigEntry

_LOGGER = logging.getLogger(__name__)

DOMAIN = "scene_rollback"

# Node-RED endpoint that stores rollback state
NODE_RED_ENDPOINT = "http://localhost:1880/endpoint/scene-cache/"
POST_TIMEOUT_SECONDS = 2

# Domains whose entities are cacheable (matches cache-states/utils.ts)
CACHEABLE_DOMAINS = ["light", "switch", "fan", "climate", "lock", "cover", "media_player"]


def _get_scene_entity_ids(hass: HomeAssistant, scene_entity_ids: list[str]) -> list[str]:
    """Extract the entity_ids that a scene controls from its state attributes.

    HA scene states store affected entities in state.attributes.entity_id.
    If that isn't available, fall back to all cacheable-domain entities.
    """
    affected: list[str] = []

    for scene_eid in scene_entity_ids:
        state = hass.states.get(scene_eid)
        if state is None:
            continue

        # Scene attributes contain the entity_ids it controls
        entity_ids = state.attributes.get("entity_id")
        if entity_ids:
            if isinstance(entity_ids, str):
                entity_ids = [entity_ids]
            affected.extend(entity_ids)

    if affected:
        return list(set(affected))

    # Fallback: capture all cacheable domain entities
    _LOGGER.warning("Could not resolve scene entities, capturing all cacheable entities")
    for state in hass.states.async_all():
        domain = state.entity_id.split(".")[0]
        if domain in CACHEABLE_DOMAINS:
            affected.append(state.entity_id)

    return affected


def _state_to_dict(hass: HomeAssistant, entity_id: str) -> dict[str, Any] | None:
    """Convert a Home Assistant state object to a serializable dict."""
    state = hass.states.get(entity_id)
    if state is None or state.state in ("unavailable", "unknown"):
        return None

    return {
        "entity_id": entity_id,
        "state": state.state,
        "attributes": dict(state.attributes),
    }


async def _post_to_nodered(entity_states: list[dict], scene_ids: list[str]) -> bool:
    """POST pre-scene state to Node-RED. Returns True on success."""
    payload = {
        "scene_ids": scene_ids,
        "entities": entity_states,
        "timestamp": __import__("time").time(),
    }

    try:
        timeout = aiohttp.ClientTimeout(total=POST_TIMEOUT_SECONDS)
        async with aiohttp.ClientSession(timeout=timeout) as session:
            async with session.post(NODE_RED_ENDPOINT, json=payload) as resp:
                if resp.status == 200:
                    _LOGGER.debug(
                        "Scene rollback: captured %d entities for scenes %s",
                        len(entity_states),
                        scene_ids,
                    )
                    return True
                else:
                    _LOGGER.warning(
                        "Scene rollback POST returned %d: %s",
                        resp.status,
                        await resp.text(),
                    )
                    return False
    except Exception as exc:
        _LOGGER.warning("Scene rollback POST failed: %s", exc)
        return False


def setup_service_call_interceptor(
    hass: HomeAssistant, domain: str, service: str, intercept_func
) -> Any:
    """Intercept a domain service by replacing its job target with a proxy.

    Returns a removal callable that restores the original handler, or None on failure.
    """
    services = hass.services._services  # type: ignore[attr-defined]
    existing_service = services.get(domain, {}).get(service)
    if not existing_service:
        _LOGGER.error("Could not find existing service %s.%s", domain, service)
        return None

    original_target = existing_service.job.target

    async def service_func_proxy(call: ServiceCall) -> None:
        """Proxy that captures state before forwarding to the real handler."""
        try:
            await intercept_func(call)
        except Exception:
            _LOGGER.exception("Error in scene_rollback pre-capture for %s.%s", domain, service)
        # Always forward to original handler
        await original_target(call)

    existing_service.job.target = service_func_proxy

    def remove() -> None:
        existing_service.job.target = original_target

    return remove


def create_scene_interceptor(hass: HomeAssistant):
    """Create an interceptor for scene.turn_on.

    Captures current state of affected entities before the scene activates.
    """
    async def scene_turn_on_interceptor(call: ServiceCall) -> None:
        """Capture pre-scene state and POST to Node-RED."""
        entity_ids = call.data.get("entity_id")
        if entity_ids is None:
            return

        if isinstance(entity_ids, str):
            entity_ids = [entity_ids]

        # Resolve which entities the scene(s) will affect
        affected_entity_ids = _get_scene_entity_ids(hass, entity_ids)

        if not affected_entity_ids:
            _LOGGER.debug("Scene rollback: no affected entities found for %s", entity_ids)
            return

        # Capture current state of each affected entity
        entity_states = []
        for eid in affected_entity_ids:
            state_dict = _state_to_dict(hass, eid)
            if state_dict is not None:
                entity_states.append(state_dict)

        if not entity_states:
            return

        # POST to Node-RED (fire-and-forget with timeout)
        await _post_to_nodered(entity_states, entity_ids)

    return scene_turn_on_interceptor


async def async_setup(hass: HomeAssistant, config: dict) -> bool:
    """Set up the Scene Rollback component."""
    hass.data[DOMAIN] = {"remove_interceptors": []}

    interceptor = create_scene_interceptor(hass)
    remover = setup_service_call_interceptor(hass, "scene", "turn_on", interceptor)

    if remover:
        _LOGGER.warning("Scene Rollback: intercepting scene.turn_on")
        hass.data[DOMAIN]["remove_interceptors"].append(remover)
    else:
        # Scene service may not be registered yet -- retry after startup
        async def delayed_setup() -> None:
            await asyncio.sleep(10)
            r = setup_service_call_interceptor(hass, "scene", "turn_on", interceptor)
            if r:
                hass.data[DOMAIN]["remove_interceptors"].append(r)
            else:
                _LOGGER.error(
                    "Scene Rollback failed to initialize even after delay"
                )

        hass.async_create_task(delayed_setup())

    return True


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Set up from config entry (no-op, YAML only)."""
    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Unload config entry -- restore original service handlers."""
    if DOMAIN in hass.data and "remove_interceptors" in hass.data[DOMAIN]:
        for remove_func in hass.data[DOMAIN]["remove_interceptors"]:
            remove_func()
        hass.data[DOMAIN]["remove_interceptors"].clear()
    return True
