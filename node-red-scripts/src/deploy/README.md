# Node-RED TypeScript Deployment

Simple deployment system for Node-RED TypeScript functions.

## Setup

1. First, generate the function mappings:
   ```bash
   npm run map
   ```
   This creates `src/deploy/mappings/node-mappings.json` by comparing compiled JS files with Node-RED function nodes.

2. Configure authentication:
   - Copy `.env.example` to `.env` (or create `.env` manually)
   - Set your Home Assistant token in `.env`
   - The `.env` file is gitignored for security

## Authentication

For Home Assistant Node-RED addon, you need:
- **HA_TOKEN**: Long-lived access token from Home Assistant
  - Go to your HA profile → Security → Long-lived access tokens
  - Create a new token and copy it to `.env`

The system uses direct file access to flows.json since the Node-RED Admin API is not exposed through HA ingress.

## Usage

### Build only
```bash
npm run build
```

### Build and deploy changed files
```bash
npm run build:deploy
```

### Deploy specific files
```bash
# Deploy one file
npm run deploy -- src/presence/presence.ts

# Deploy multiple files
npm run deploy -- src/presence/presence.ts src/time-of-use.ts

# Force deploy (skip change detection)
npm run deploy -- src/presence/presence.ts --force

# Dry run (preview what would be deployed)
npm run deploy -- src/presence/presence.ts --dry-run

# Deploy all mapped functions
npm run deploy:all

# Skip backup
npm run deploy -- src/presence/presence.ts --no-backup

# Deploy and rename nodes to match file names
npm run deploy:all -- --rename

# Only rename nodes without deploying
npm run deploy:rename
npm run deploy:rename -- --dry-run
```

### Watch mode (no deployment)
```bash
npm run watch
```

## How it works

1. **Mapping**: The mapper compares normalized code between `dist/` files and Node-RED function nodes
2. **Change Detection**: Only deploys functions that have both:
   - Changed code (different hash)
   - Valid mappings (not low confidence)
   - Can be bypassed with `--force` flag
3. **Backup**: Before deployment, flows.json is backed up to `/Volumes/config/node-red-backups/`
4. **Deploy**: Updates only changed function nodes directly in flows.json
5. **Restart**: Automatically attempts to restart Node-RED addon via HA CLI or API

## Integration with build

- `npm run build:deploy` - Builds all TypeScript files and deploys only the changed ones
- `npm run deploy` - Standalone deployment of specific files (requires built JS files in dist/)
- The build script tracks which files were actually rebuilt and passes only those to deploy

## Mapping confidence levels

- **Exact**: Code hash matches perfectly
- **High**: Source file comment found in function
- **Medium**: Name-based matching
- **None**: No match found (needs manual mapping)

## Files

- `src/deploy/deploy.ts` - Main deployment script with integrated rename functionality
- `src/deploy/backup.ts` - Handles flow backups  
- `src/deploy/rename.ts` - Renames function nodes to match file names
- `src/deploy/reconcile.ts` - AI reconciliation logic for unmapped functions
- `src/deploy/mappings/` - Directory containing mapping files
  - `mapper.ts` - Generates function mappings
  - `node-mappings.json` - Auto-generated mappings
  - `node-mappings-ai-enhanced.json` - AI-enhanced mappings (when using --ai)
  - `prompts/` - Markdown templates for AI prompts
- `.env` - Environment configuration (gitignored)