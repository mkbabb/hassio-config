from __future__ import annotations

import argparse
import json
import re
import uuid
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any, NotRequired, Optional, TypeAlias, TypedDict, TypeVar

import requests
import yaml
from loguru import logger

# Type definitions
GroupKey: TypeAlias = tuple[str, ...]


class EntityState(TypedDict):
    entity_id: str
    state: str
    attributes: dict[str, Any]
    context: NotRequired[dict[str, Any]]
    last_changed: NotRequired[str]
    last_updated: NotRequired[str]
    timeSinceChangedMs: NotRequired[int]


class NormalizedEntity(TypedDict):
    entity_id: str
    state: str
    domain: str
    normalized_attributes: dict[str, Any]
    original_attributes: dict[str, Any]


class SceneConfig(TypedDict):
    id: str

    name: str | None

    icon: str | None

    entities: dict[str, dict[str, Any]]
    metadata: dict[str, dict[str, Any]]


T = TypeVar('T')

ENTITY_STATES_URL = "http://homeassistant.local:1880/endpoint/entities/"

# Scene constants
SCENE_ID_LENGTH = 13
DEFAULT_SCENE_ICON = 'mdi:palette'
DATETIME_FORMAT = '%Y-%m-%d %H:%M'

# Scene format constants
SCENE_REQUIRED_FIELDS = {'id', 'name', 'entities'}

# Domain configuration
DOMAIN_ICONS = {
    'light': 'mdi:lightbulb-group',
    'media_player': 'mdi:speaker-multiple',
    'climate': 'mdi:thermostat',
    'fan': 'mdi:fan',
    'switch': 'mdi:toggle-switch',
    'cover': 'mdi:window-shutter',
}

# Domain-specific writable attributes (mirrors cache-states/utils.ts filterAttributes)
# Light color attrs are handled separately by color_mode logic
DOMAIN_ATTRIBUTES = {
    'light': {'brightness', 'effect'},  # Color attrs added dynamically by color_mode
    'fan': {'percentage'},
    'climate': {'preset_mode', 'temperature', 'hvac_mode'},
    'cover': set(),     # position handled via service mapping below
    'media_player': {'volume_level', 'is_volume_muted', 'source'},
    'lock': set(),
    'switch': set(),
}

# Read-only / informational attributes that should NEVER appear in scene output
IGNORED_SCENE_ATTRIBUTES = {
    # Capability attributes
    'min_color_temp_kelvin',
    'max_color_temp_kelvin',
    'min_mireds',
    'max_mireds',
    'supported_features',
    'supported_color_modes',
    'effect_list',
    'preset_modes',
    # Informational
    'friendly_name',
    'icon',
    'device_class',
    'unit_of_measurement',
    'entity_id',  # Group member list (added back by grouping logic)
    # Timestamps
    'last_changed',
    'last_updated',
    'timeSinceChangedMs',
    # Context
    'id',
    'parent_id',
    'user_id',
    # Climate read-only
    'current_temperature',
    'current_humidity',
    'hvac_action',
    'min_temp',
    'max_temp',
    'target_temp_step',
    'target_temp_high',
    'target_temp_low',
    # Cover read-only
    'current_position',
    'current_tilt_position',
    # Fan read-only
    'percentage_step',
    # Lock read-only
    'changed_by',
    'battery_level',
    # Air purifier / fan informational
    'active_time',
    'display_status',
    'child_lock',
    'mode',
    'screen_status',
    'night_light',
}

BLACKLISTED_ENTITIES = [
    # car
    "son_of_toast",
    # grow lights
    re.compile(r".*grow.*", re.IGNORECASE),
    # blinds
    re.compile(r".*blinds.*", re.IGNORECASE),
    # air purifiers
    re.compile(r".*air_purifier.*", re.IGNORECASE),
    # garage door switches
    re.compile(r"switch\.ratgdov25i_4b1c3b.*", re.IGNORECASE),
    "lock.ratgdov25i_4b1c3b_lock_remotes",
    # washer/dryer
    "washer_power",
    "dryer_power",
    # water pump
    "switch.plant_water_pump_switch",
    # ESPresence
    re.compile(r"espresense_.*", re.IGNORECASE),
    # media players
    re.compile(r".*media_player\..*"),
    # sonos beam
    re.compile(r".*sonos_beam.*", re.IGNORECASE),
]


def is_blacklisted(entity_id: str) -> bool:
    for blacklist_item in BLACKLISTED_ENTITIES:
        if isinstance(blacklist_item, str):
            if blacklist_item in entity_id:
                return True
        elif isinstance(blacklist_item, re.Pattern):
            if blacklist_item.search(entity_id):
                return True

    return False


def normalize_entity(entity: EntityState) -> NormalizedEntity:
    """Normalize entity attributes based on domain, mirroring cache-states/utils.ts filterAttributes()"""
    domain = entity['entity_id'].split('.')[0]
    attributes = entity['attributes'].copy()
    state = entity['state']
    normalized_attributes: dict[str, Any] = {}

    if domain == 'light':
        if state == 'on':
            # Use color_mode to determine which color representation to save
            # Mirrors TypeScript: filterAttributes() lines 38-52
            color_mode = attributes.get('color_mode')

            if color_mode and color_mode in attributes and attributes[color_mode] is not None:
                # Save the direct attribute (e.g., color_temp value)
                normalized_attributes[color_mode] = attributes[color_mode]

            # Many color modes use {mode}_color format (e.g., hs -> hs_color, rgb -> rgb_color)
            if color_mode:
                color_mode_color = f"{color_mode}_color"
                if color_mode_color in attributes and attributes[color_mode_color] is not None:
                    normalized_attributes[color_mode_color] = attributes[color_mode_color]

            # Save standard attributes (brightness, effect) independent of color mode
            for attr in DOMAIN_ATTRIBUTES.get('light', set()):
                if attr in attributes and attributes[attr] is not None:
                    normalized_attributes[attr] = attributes[attr]
        # If light is off: no attributes needed (just state)

    elif domain == 'cover':
        # Map current_position -> position (writable param) only when partially open
        current_position = attributes.get('current_position')
        if current_position is not None and 0 < current_position < 100:
            normalized_attributes['position'] = current_position

    elif domain == 'fan':
        if state == 'on':
            for attr in DOMAIN_ATTRIBUTES.get('fan', set()):
                if attr in attributes and attributes[attr] is not None:
                    normalized_attributes[attr] = attributes[attr]

    else:
        # For other domains: use DOMAIN_ATTRIBUTES allowlist
        relevant_attrs = DOMAIN_ATTRIBUTES.get(domain, set())
        for attr in relevant_attrs:
            if attr in attributes and attributes[attr] is not None:
                normalized_attributes[attr] = attributes[attr]

    return {
        'entity_id': entity['entity_id'],
        'state': entity['state'],
        'domain': domain,
        'normalized_attributes': normalized_attributes,
        'original_attributes': attributes,
    }


def get_group_key(entity: NormalizedEntity) -> GroupKey:
    """Generate stable group key from entity attributes"""
    attrs = entity['normalized_attributes']
    key_parts = [entity['domain'], entity['state']]

    for k, v in sorted(attrs.items()):

        if isinstance(v, (list, dict)):
            v = str(sorted(v) if isinstance(v, list) else sorted(v.items()))

        key_parts.append(f"{k}:{v}")

    return tuple(key_parts)


def process_entity_group(
    entities: list[NormalizedEntity],
) -> tuple[str, dict[str, Any]]:
    """Process a group of similar entities"""
    base_entity = entities[0]
    base_path = base_entity['entity_id'].split('.')

    attributes = {
        k: v
        for k, v in base_entity['normalized_attributes'].items()
        if k not in IGNORED_SCENE_ATTRIBUTES
    }

    if len(base_path) < 2:
        return base_entity['entity_id'], attributes

    # Create group name by removing numeric suffixes
    base_name = '.'.join(
        [
            base_path[0],
            '_'.join(
                part
                for part in base_path[1].split('_')
                if not any(c.isdigit() for c in part)
            ),
        ]
    )

    config = attributes
    config['entity_id'] = [e['entity_id'] for e in entities]
    config['state'] = base_entity['state']

    if 'icon' not in config:
        domain = base_entity['domain']
        config['icon'] = DOMAIN_ICONS.get(domain, f"mdi:{domain}")

    return base_name, config


def group_entities(
    normalized_entities: list[NormalizedEntity],
) -> dict[str, dict[str, Any]]:
    """Group similar entities based on their attributes"""
    groups: dict[GroupKey, list[NormalizedEntity]] = defaultdict(list)
    result: dict[str, dict[str, Any]] = {}

    # Group by attribute similarity
    for entity in normalized_entities:
        key = get_group_key(entity)

        groups[key].append(entity)

    # sort the groups by the key to ensure consistent output
    groups = dict(sorted(groups.items(), key=lambda x: x[0]))

    logger.debug(
        f"Grouped {len(normalized_entities)} entities into {len(groups)} groups"
    )

    # Process each group
    for key, group in groups.items():

        if len(group) == 1:
            entity = group[0]
            config = {
                k: v
                for k, v in entity['normalized_attributes'].items()
                if k not in IGNORED_SCENE_ATTRIBUTES
            }
            config['state'] = entity['state']

            result[entity['entity_id']] = config
        else:
            entity_id, config = process_entity_group(group)

            result[entity_id] = config

    return result


def clean_dict(d: Any) -> Any:
    """Remove empty values from nested structures"""
    if isinstance(d, dict):
        return {
            k: clean_dict(v)
            for k, v in d.items()
            if v is not None and v != {} and v != []
        }
    if isinstance(d, list):
        return [clean_dict(x) for x in d if x is not None]

    return d


def create_scene_config(
    entities: dict[str, dict[str, Any]],
    id: Optional[str] = None,
    name: Optional[str] = None,
    icon: Optional[str] = None,
) -> SceneConfig:
    """Create a new scene configuration"""
    logger.debug(f"Creating scene with {len(entities)} entity-groups")
    logger.debug(f"Scene ID: {id}")
    logger.debug(f"Scene name: {name}")
    logger.debug(f"Scene icon: {icon}")

    return {
        'id': id if id is not None else str(uuid.uuid4().int)[:SCENE_ID_LENGTH],
        'name': name,
        'icon': icon,
        'entities': entities,
        'metadata': {entity_id: {'entity_only': True} for entity_id in entities},
    }


def format_scene_yaml(scenes: SceneConfig | list[SceneConfig]) -> str:
    scenes = [scenes] if isinstance(scenes, dict) else scenes
    """Format scene as YAML with consistent styling"""
    scenes = [clean_dict(scene) for scene in scenes]

    out = yaml.dump(
        scenes,
        allow_unicode=True,
        default_flow_style=False,
        sort_keys=False,
        width=80,
        indent=2,
    )
    return out


def validate_entity_state(state: Any) -> None:
    """Validate entity state structure"""
    if not isinstance(state, dict):
        raise ValueError("Each state must be a dictionary")

    required_fields = {'entity_id', 'state', 'attributes'}
    missing = required_fields - set(state.keys())

    if missing:
        raise ValueError(f"Missing required fields: {missing}")


def extract_state_from_scene_entity(
    entity_id: str, config: dict[str, Any]
) -> EntityState:
    """Convert scene entity config to entity state format"""
    # Extract state and build base attributes
    state = config.pop('state', 'off')

    # Build attributes dictionary
    attributes = {k: v for k, v in config.items() if v is not None}

    return {'entity_id': entity_id, 'state': state, 'attributes': attributes}


def scene_to_entity_states(scene: dict[str, Any]) -> list[EntityState]:
    """Convert scene configuration to list of entity states"""
    if not all((field in scene) for field in SCENE_REQUIRED_FIELDS):
        raise ValueError(f"Scene missing required fields: {SCENE_REQUIRED_FIELDS}")

    entities = scene['entities']
    return [
        extract_state_from_scene_entity(entity_id, dict(config))
        for entity_id, config in entities.items()
    ]


def optimize_existing_scene(scene_yaml: str) -> SceneConfig:
    """Optimize an existing scene configuration

    Args:
        scene_yaml: YAML string of existing scene

    Returns:
        Optimized scene as YAML string
    """
    try:
        # Load scene YAML
        scene = yaml.safe_load(scene_yaml)

        if not scene:
            raise ValueError("Empty scene configuration")

        # Convert scene entities to entity states
        entity_states = scene_to_entity_states(scene)

        # Normalize entities
        normalized = map(normalize_entity, entity_states)

        # Group similar entities
        processed = group_entities(list(normalized))

        # Create optimized scene
        return create_scene_config(
            entities=processed,
            id=scene.get('id'),
            name=scene.get('name'),
            icon=scene.get('icon'),
        )

    except yaml.YAMLError as e:
        raise ValueError(f"Invalid scene YAML: {e}")
    except Exception as e:
        raise RuntimeError(f"Error optimizing scene: {e}") from e


def process_scene(
    entity_states: list[EntityState],
    id: Optional[str] = None,
    name: Optional[str] = None,
    icon: Optional[str] = None,
    optimize: bool = True,
) -> SceneConfig:
    """Process entity states into a scene configuration

    Args:
        entity_states: List of entity states to process
        name: Optional name for the scene
        id: Optional ID for the scene
        optimize: Whether to perform grouping optimization

    Returns:
        Formatted YAML string for the scene
    """
    try:
        # Validate all states
        for state in entity_states:
            validate_entity_state(state)

        if optimize:
            # Normalize and group entities
            normalized = map(normalize_entity, entity_states)
            processed = group_entities(list(normalized))
        else:
            # Simple entity processing without optimization
            processed = {}
            for state in entity_states:
                normalized = normalize_entity(state)
                config = {
                    k: v
                    for k, v in normalized['normalized_attributes'].items()
                    if k not in IGNORED_SCENE_ATTRIBUTES
                }
                config['state'] = normalized['state']
                processed[state['entity_id']] = config

        # Create new scene
        return create_scene_config(entities=processed, id=id, name=name, icon=icon)

    except Exception as e:
        raise RuntimeError(f"Error processing scene: {e}") from e


def read_scenes_from_file(file_path: Path) -> list[SceneConfig]:
    """Read and parse scenes from YAML file

    Args:
        file_path: Path to YAML file

    Returns:
        List of parsed scene configurations
    """
    try:
        if not file_path.exists():
            return []

        scenes = yaml.safe_load(file_path.read_text()) or []

        if not isinstance(scenes, list):
            scenes = [scenes] if scenes else []

        return scenes

    except yaml.YAMLError as e:
        raise ValueError(f"Error parsing YAML file: {e}")


def merge_scene(
    new_scene: SceneConfig, current_scene: SceneConfig | None
) -> SceneConfig:

    name = (
        current_scene.get("name")
        if current_scene is not None
        else new_scene.get("name")
    )
    name = (
        name
        if name is not None
        else f"Scene {datetime.now().strftime(DATETIME_FORMAT)}"
    )

    icon = (
        current_scene.get("icon")
        if current_scene is not None
        else new_scene.get("icon")
    )
    icon = icon if icon is not None else DEFAULT_SCENE_ICON

    new_scene["name"] = name

    new_scene["icon"] = icon

    logger.debug(f"Updated scene with name: {name} and icon: {icon}")

    return new_scene


def update_scenes_list(
    new_scene: SceneConfig, scenes: list[SceneConfig]
) -> list[SceneConfig]:
    """Update scene in list of scenes or append if not found

    Args:
        scenes: List of existing scene configurations
        new_scene: New scene configuration to add/update

    Returns:
        Updated list of scenes
    """
    # Try to find and update existing scene
    for i, scene in enumerate(scenes):
        if not (scene.get('id') == new_scene['id']):
            continue

        scenes[i] = merge_scene(
            new_scene=new_scene,
            current_scene=scene,
        )

        return scenes

    # Scene not found, append new one
    scenes.append(new_scene)
    return scenes


def main() -> None:
    """CLI entry point"""
    parser = argparse.ArgumentParser(description="Process Home Assistant scenes")

    parser.add_argument(
        "-i",
        "--input",
        type=str,
        required=False,
        default=ENTITY_STATES_URL,
        help="JSON file or URL containing entity states",
    )

    parser.add_argument(
        "-o",
        "--output",
        type=Path,
        required=False,
        default=Path("./scenes.yaml"),
        help="Output file for the scene configuration in YAML format",
    )

    parser.add_argument(
        "--id",
        help="Optional scene ID (defaults to random UUID)",
        default="2000310699005",
    )

    parser.add_argument("--name", help="Optional scene name")

    parser.add_argument("--icon", help="Optional scene icon")

    parser.add_argument(
        "--verbose",
        action="store_true",
        help="Perform entity grouping optimization on an existing scene",
    )

    parser.add_argument(
        "--optimize-scene", action="store_true", help="Optimize an existing scene YAML"
    )

    args = parser.parse_args()

    # If the input file is a URL, download the content
    if args.input.startswith("http"):
        logger.debug(f"Downloading entity states from URL: {args.input}")
        input_data = requests.get(args.input).text
    else:
        logger.debug(f"Reading entity states from file: {args.input}")
        args.input = Path(args.input)
        input_data = args.input.read_text()

    scene = None

    if args.optimize_scene:
        scene = optimize_existing_scene(input_data)
    else:
        # Load entity states from JSON
        try:
            states = json.loads(input_data)
        except json.JSONDecodeError as e:
            raise ValueError(f"Invalid JSON input: {e}")

        states = [state for state in states if not is_blacklisted(state["entity_id"])]

        scene = process_scene(
            states,
            id=args.id,
            name=args.name,
            icon=args.icon,
            optimize=False,
        )

    if args.output is not None:
        # Update existing scene file
        if args.id and args.output.exists():
            scenes = read_scenes_from_file(args.output)

            updated = update_scenes_list(new_scene=scene, scenes=scenes)

            args.output.write_text(format_scene_yaml(updated))
        else:
            # Write new scene file
            scene = merge_scene(scene, None)
            args.output.write_text(format_scene_yaml(scene))
    else:
        scene = merge_scene(scene, None)
        print(
            format_scene_yaml(scene),
        )


if __name__ == "__main__":
    main()
