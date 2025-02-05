// @ts-ignore
let staticBlacklist = flow.get("staticBlacklist");

if (staticBlacklist == null) {
    // @ts-ignore
    flow.set("staticBlacklist", []);
    // @ts-ignore
    staticBlacklist = flow.get("staticBlacklist");
}

// @ts-ignore
const payload = msg.payload;

if (!staticBlacklist.includes(payload.entity_id)) {
    staticBlacklist.push(payload.entity_id);
}

// @ts-ignore
msg.staticBlacklist = staticBlacklist;
