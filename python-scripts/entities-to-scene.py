from __future__ import annotations

import argparse
import json
import re
import uuid
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime
from functools import lru_cache
from pathlib import Path
from typing import Any, NotRequired, Optional, TypeAlias, TypedDict, TypeVar

import colour
import numpy as np
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

# Color constants
MAX_BRIGHTNESS = 255
COLOR_CACHE_SIZE = 1024
KELVIN_CONVERSION_FACTOR = 1000000

# Scene constants
SCENE_ID_LENGTH = 13
DEFAULT_SCENE_ICON = 'mdi:palette'
DATETIME_FORMAT = '%Y-%m-%d %H:%M'

# Scene format constants
SCENE_REQUIRED_FIELDS = {'id', 'name', 'entities'}

# Entity constants
ENTITY_ATTRIBUTES = {
    'supported_features',
    'supported_color_modes',
    'friendly_name',
    'device_class',
}
COLOR_FIELDS = {
    'color_temp',
    'color_temp_kelvin',
    'brightness',
    'hs_color',
    'rgb_color',
    'xy_color',
    'effect',
}
# Color mode constants
COLOR_MODES = {'color_temp', 'hs', 'xy', 'rgb', 'brightness', 'onoff'}

# Domain configuration
DOMAIN_ICONS = {
    'light': 'mdi:lightbulb-group',
    'media_player': 'mdi:speaker-multiple',
    'climate': 'mdi:thermostat',
    'fan': 'mdi:fan',
    'switch': 'mdi:toggle-switch',
    'cover': 'mdi:window-shutter',
}

DOMAIN_ATTRIBUTES = {
    'light': {'effect', 'brightness', 'rgb_color'},
    'fan': {'percentage', 'preset_mode'},
    'climate': {
        'min_temp',
        'max_temp',
        'target_temp_step',
        'target_temp_high',
        'target_temp_low',
        'preset_mode',
    },
    'cover': {'current_position'},
    'media_player': {'volume_level', 'is_volume_muted', 'source'},
}

IGNORED_ATTRIBUTES = {
    'friendly_name',
    'icon',
    'entity_id',
    'last_changed',
    'last_updated',
    'id',
    'parent_id',
    'user_id',
    'timeSinceChangedMs',
}

BLACKLISTED_ENTITIES = [
    # car
    "son_of_toast",
    # grow lights
    re.compile(r".*grow.*"),
    # air purifiers
    re.compile(r".*air_purifier.*"),
    # washer/dryer
    "washer_power",
    "dryer_power",
    # water pump
    "switch.plant_water_pump_switch",
    # ESPresnce:
    re.compile(r"espresense_.*"),
    # media players:
    re.compile(r".*media_player\..*"),
    # sonos beam:
    re.compile(r".*sonos_beam.*"),
]


def is_blacklisted(entity_id: str) -> bool:
    for blacklist_item in BLACKLISTED_ENTITIES:
        if isinstance(blacklist_item, str):
            if entity_id == blacklist_item:
                return True
        elif isinstance(blacklist_item, re.Pattern):
            if blacklist_item.match(entity_id):
                return True

    return False


@dataclass(frozen=True)
class ColorNormalizer:
    """Immutable color space conversion utilities"""

    @staticmethod
    @lru_cache(maxsize=COLOR_CACHE_SIZE)
    def xy_to_rgb(
        xy: tuple[float, float], brightness: int = MAX_BRIGHTNESS
    ) -> list[int]:
        Y = brightness / MAX_BRIGHTNESS
        XYZ = colour.xy_to_XYZ([xy[0], xy[1], Y])
        RGB = colour.XYZ_to_sRGB(XYZ)

        return np.clip(RGB * MAX_BRIGHTNESS, 0, MAX_BRIGHTNESS).astype(int).tolist()  # type: ignore

    @staticmethod
    @lru_cache(maxsize=COLOR_CACHE_SIZE)
    def hs_to_rgb(
        hs: tuple[float, float], brightness: int = MAX_BRIGHTNESS
    ) -> list[int]:
        HSV = np.array([hs[0], hs[1] / 100, brightness / MAX_BRIGHTNESS])
        RGB = colour.HSV_to_RGB(HSV)

        return np.clip(RGB * MAX_BRIGHTNESS, 0, MAX_BRIGHTNESS).astype(int).tolist()  # type: ignore

    @staticmethod
    @lru_cache(maxsize=COLOR_CACHE_SIZE)
    def color_temp_to_rgb(temp_kelvin: int) -> list[int]:
        sd = colour.sd_blackbody(temp_kelvin)
        XYZ = colour.sd_to_XYZ(sd)
        RGB = colour.XYZ_to_sRGB(XYZ)

        return np.clip(RGB * MAX_BRIGHTNESS, 0, MAX_BRIGHTNESS).astype(int).tolist()  # type: ignore


def normalize_colors(attributes: dict[str, Any]) -> dict[str, Any]:
    """Pure function for color normalization"""
    if 'supported_color_modes' not in attributes:
        return attributes

    normalized = attributes.copy()
    brightness = attributes.get('brightness', MAX_BRIGHTNESS)

    color_conversions = [
        ('xy_color', lambda xy: ColorNormalizer.xy_to_rgb(tuple(xy), brightness)),
        ('hs_color', lambda hs: ColorNormalizer.hs_to_rgb(tuple(hs), brightness)),
        ('color_temp_kelvin', ColorNormalizer.color_temp_to_rgb),
        (
            'color_temp',
            lambda t: ColorNormalizer.color_temp_to_rgb(KELVIN_CONVERSION_FACTOR // t),
        ),
    ]

    for attr, converter in color_conversions:
        if attr in attributes:
            normalized['rgb_color'] = converter(attributes[attr])  # type: ignore
            return normalized

    return normalized


def normalize_entity(entity: EntityState) -> NormalizedEntity:
    """Pure function for entity normalization"""
    domain = entity['entity_id'].split('.')[0]
    attributes = entity['attributes'].copy()

    if domain == 'light':
        attributes = normalize_colors(attributes)

    relevant_attrs = DOMAIN_ATTRIBUTES.get(domain, set())
    normalized_attributes = {
        k: v for k, v in attributes.items() if k in relevant_attrs and v is not None
    }

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

    # filter out ignored attributes from the base entity's original attributes
    attributes = {
        k: v
        for k, v in base_entity['normalized_attributes'].items()
        if k not in IGNORED_ATTRIBUTES
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
            config = entity['normalized_attributes'].copy()
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
    if isinstance(d, np.ndarray):
        return clean_dict(d.tolist())

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
            processed = {
                state['entity_id']: {**state['attributes'], 'state': state['state']}
                for state in entity_states
            }

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
