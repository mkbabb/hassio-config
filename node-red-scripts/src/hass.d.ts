declare namespace Hass {
    /**
     * Template of attributes for various home assistant devices.
     */
    export namespace Attributes {
        interface Switch {
            friendly_name: string;
            supported_features: number;
        }

        interface Light extends Switch {
            min_mireds?: number;
            max_mireds?: number;
            effect_list?: string[];
            brightness?: number;
            color_temp?: number;
        }

        interface LightGroup extends Light {
            entity_id: string | string[];
        }

        interface BinarySensor extends Switch {
            node_id: number;
            value_index: number;
            value_instance: number;
            value_id: string;
        }

        interface Climate extends Switch {
            min_temp: number;
            max_temp: number;
            current_temperature: number;
            temperature: number;
            target_temp_high: null;
            target_temp_low: null;
            current_humidity: number;
            fan_mode: string;
            hvac_action: string;
            preset_mode: string;
            aux_heat: string;
            fan: string;
            climate_mode: string;
            equipment_running: string;
            fan_min_on_time: number;
        }
    }

    type Attribute =
        | Attributes.Light
        | Attributes.LightGroup
        | Attributes.Switch
        | Attributes.Climate;

    /**
     * Template state for a hass entity.
     * Usually found in msg.payload within NodeRed.
     */
    interface State {
        entity_id: string;
        state: string;
        attributes: Attribute;

        last_changed: string;
        last_updated: string;
        context: {
            id: string;
            parent_id: string;
            user_id: string;
        };
        timeSinceChangedMs: number;
    }

    /**
     * NodeRed message object template.
     * payload and data attributes are normally here,
     * but the message object can contain anything.
     */
    interface Message<T> {
        payload: T;

        data: {
            entity_id: string;
            old_state: State;
            new_state: State;
        };

        [s: string]: any;
    }

    interface Service {
        domain: string;
        service: string;
        entity_id: string;
        data?: {
            [s: string]: any;
            entity_id: string;
        };
        merge_context?: string;
        alternative_template_tags?: boolean;
        output_location?: string;
    }
}
