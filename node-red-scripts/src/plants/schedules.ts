// Types for our schedule system
export type Schedule = {
    name: string;
    entities: (string | RegExp)[];
    start: string;
    end: string;
    precedence: number;
};

export type NormalizedSchedule = {
    name: string;
    entities: RegExp[];
    start: Date;
    end: Date;
    precedence: number;
};

// @ts-ignore
const schedules: Schedule[] = [
    {
        name: "plants_global",
        entities: ["(switch|light)\\.(.*grow.*)"],
        start: "06:00",
        end: "23:00",
        precedence: 1
    },
    // {
    //     name: "bedroom_plants",
    //     entities: ["(switch|light)\\.(.*bedroom.*grow.*)"],
    //     start: "09:00",
    //     end: "23:00",
    //     precedence: 2
    // },
    // {
    //     name: "hey",
    //     entities: ["light\.penguin_light"],
    //     start: "09:00",
    //     end: "18:45",
    //     precedence: 3
    // }
];

// @ts-ignore
flow.set("schedules", schedules);
