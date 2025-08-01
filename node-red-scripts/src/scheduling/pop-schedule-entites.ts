// @ts-ignore
let cachedTimes = flow.get("cachedTimes");
if (cachedTimes == null) {
    // @ts-ignore
    flow.set("cachedTimes", {});
    // @ts-ignore
    cachedTimes = flow.get("cachedTimes");
}

const times = Object.entries(cachedTimes).map(([entity_id, time]) => ({
    entity_id,
    time
}));

//@ts-ignore
flow.set("cachedTimes", {});

// @ts-ignore
msg.payload = times;
