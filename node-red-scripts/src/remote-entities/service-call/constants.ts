export const DEFAULT_REMOTE_DATA = {
    num_repeats: 1,
    delay_secs: 0.4,
    hold_secs: 0.1
};

// make an enum for light commands
export enum LightCommand {
    TURN_ON = "turn on",
    TURN_OFF = "turn off",
    BRIGHTNESS_UP = "brightness up",
    BRIGHTNESS_DOWN = "brightness down",
    COLOR = "color",
    WHITE = "white",
    EFFECT = "effect",
    TRANSITION = "transition"
}

export enum FanCommand {
    TURN_ON = "turn on",
    TURN_OFF = "turn off",
    SPEED_UP = "speed up",
    SPEED_DOWN = "speed down",
    OSCILLATE = "oscillate",
    TIMER = "timer"
}
