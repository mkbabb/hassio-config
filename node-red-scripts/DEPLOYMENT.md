# Node-RED TypeScript Deployment

Simple deployment system for Node-RED TypeScript functions.

## Setup

1. First, generate the function mappings:
   ```bash
   npm run map
   ```
   This creates `node-mappings.json` by comparing compiled JS files with Node-RED function nodes.

2. Set environment variables:
   ```bash
   export NODE_RED_URL="http://homeassistant.local:8123/a0d7b954_nodered/ingress"
   export HA_TOKEN="your-home-assistant-token"
   ```

## Usage

### Build only
```bash
npm run build
```

### Build and deploy
```bash
npm run deploy
```

### Dry run (preview deployment)
```bash
npm run deploy:dry-run
```

### Watch mode (no deployment)
```bash
npm run watch
```

## How it works

1. **Mapping**: The mapper compares normalized code between `dist/` files and Node-RED function nodes
2. **Backup**: Before deployment, flows.json is backed up to `/Volumes/config/node-red-backups/`
3. **Deploy**: Updates function node code via Node-RED Admin API

## Mapping confidence levels

- **Exact**: Code hash matches perfectly
- **High**: Source file comment found in function
- **Medium**: Name-based matching
- **None**: No match found (needs manual mapping)

## Files

- `src/deploy/mapper.ts` - Generates function mappings
- `src/deploy/backup.ts` - Handles flow backups
- `src/deploy/deploy.ts` - Deploys to Node-RED
- `node-mappings.json` - Mapping configuration