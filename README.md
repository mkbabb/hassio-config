# `hassio-config` 🏡

Herein lies the configuration files, scripts, & c. for my Home Assistant setup.

I'm not wont to hassio's automations or scripting, so I've written most of my
automations using Node-RED in conjunction with the `function` nodes it provides.

All of the functions therein are written in TypeScript using a custom build process
(defined in [`node-red-scripts/build.ts`](./node-red-scripts/build.ts)) that transpiles
the entirety of [`node-red-scripts/src`](./node-red-scripts/src) into one JavaScript
file per script, which is then copied to
[`node-red-scripts/dist`](./node-red-scripts/dist) directory for Node-RED to use
(unfortunately you've got to copy and paste hereafter).

The following will be a delineation of the various components of my setup, including a
select few configuration files, scripts (Node-RED being the predominant section), and
automations.

Most files should commented appropriately, but if you have any questions, feel free to
ask.

## Configuration Files

### [`configuration.yaml`](./configuration.yaml)

TODO

### [`customize.yaml`](./customize.yaml)

Only of note insofar as it's used as a hack to modify the radius of the `zone.home`
entity.

## Node-RED Scripts

There's quite a few here, and some leverage various hassio config files, like the
[`remote-entities`](node-red-scripts/dist/remote-entities/) series leveraging the
[`input_text.yaml`](./input_text.yaml) files & c. I'll go through each of them in turn.

### [`cache-states`](./node-red-scripts/src/cache-states/) 📦

### [`chronos`](./node-red-scripts/src/chronos/) 🕰️

### [`get-domain-entities`](./node-red-scripts/src/get-domain-entities/) 🏠

### [`plants`](./node-red-scripts/src/plants/) 🌱

### [`remote-entities`](./node-red-scripts/src/remote-entities/) 📡
