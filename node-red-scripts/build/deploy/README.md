# Node-RED TypeScript Deployment

Automated deployment system for Node-RED TypeScript functions with AI-powered mapping reconciliation.

## Setup

1. First, generate the function mappings:
   ```bash
   npm run map                # Basic mapping
   npm run map -- --ai        # With AI reconciliation for unmapped functions
   ```
   This creates `src/deploy/mappings/node-mappings.json` by comparing compiled JS files with Node-RED function nodes.

2. Configure environment variables in `.env`:
   ```bash
   NODE_RED_URL=http://homeassistant.local:1880
   NODE_RED_FLOWS_PATH=/Volumes/addon_configs/a0d7b954_nodered/flows.json
   HA_USERNAME=your-username
   HA_PASSWORD=your-password
   HA_TOKEN=your-ha-token          # For addon restart fallback
   OPENAI_API_KEY=your-api-key     # Optional: For AI reconciliation
   ```

## Authentication

The system uses Node-RED Admin API with Basic Authentication:
- **HA_USERNAME** & **HA_PASSWORD**: Your Home Assistant credentials
- **HA_TOKEN**: Long-lived access token (for addon restart fallback)
  - Go to your HA profile → Security → Long-lived access tokens
  - Create a new token and copy it to `.env`

## Usage

### Build only
```bash
npm run build              # Build all TypeScript files
npm run build:dev          # Build in watch mode
```

### Deploy specific files
```bash
# Deploy one file
npm run deploy -- src/presence/presence.ts

# Deploy multiple files
npm run deploy -- src/presence/presence.ts src/time-of-use.ts

# Deploy all mapped functions
npm run deploy -- --all
```

### Deploy options
```bash
# Force deploy (skip change detection)
npm run deploy -- src/presence/presence.ts --force

# Dry run (preview what would be deployed)
npm run deploy -- src/presence/presence.ts --dry-run

# Skip backup
npm run deploy -- src/presence/presence.ts --no-backup

# Use file-based deployment instead of API
npm run deploy -- src/presence/presence.ts --no-api
```

### Rename functionality
```bash
# Deploy and rename nodes to match file names
npm run deploy -- --all --rename

# Only rename nodes without deploying
npm run deploy -- --rename-only
npm run deploy -- --rename-only --dry-run
```

### Watch mode (no deployment)
```bash
npm run watch
```

## How it works

1. **Mapping**: The mapper compares normalized code between `dist/` files and Node-RED function nodes
   - Removes comments, normalizes whitespace, removes `return msg;` footer
   - Converts to lowercase for consistent comparison
   - Creates MD5 hash for exact matching

2. **Change Detection**: Only deploys functions that have:
   - Changed code (different hash)
   - Valid mappings (confidence not "low")
   - Can be bypassed with `--force` flag

3. **Deployment Methods**:
   - **API (default)**: Uses Node-RED Admin API with "nodes" deployment type
     - Hot reloads only modified nodes without full restart
     - Requires Basic Auth with HA credentials
   - **File-based (fallback)**: Direct file modification with addon restart

4. **Backup**: Before deployment, flows.json is backed up to `/Volumes/config/node-red-backups/`

5. **AI Reconciliation** (optional with `--ai` flag):
   - Uses OpenAI GPT-4o to match unmapped functions
   - Analyzes code structure, function names, and business logic
   - Requires OPENAI_API_KEY in .env
   - 75% confidence threshold by default

## Mapping confidence levels

- **exact**: Code hash matches perfectly after normalization
- **high**: Source file comment found in function header
- **medium**: Name-based matching (filename similar to node name)
- **ai-reconciled**: Matched by AI with confidence score (75-100%)
- **low/none**: No match found (excluded from deployment)

## Files

- `src/deploy/deploy.ts` - Main deployment script with integrated rename functionality
- `src/deploy/backup.ts` - Handles flow backups  
- `src/deploy/rename.ts` - Renames function nodes to match file names
- `src/deploy/reconcile.ts` - AI reconciliation for unmapped functions
- `src/deploy/mappings/` - Directory containing mapping files
  - `mapper.ts` - Generates function mappings
  - `node-mappings.json` - Auto-generated mappings (includes AI reconciliations)
  - `reconcile-results.json` - Detailed AI reconciliation results
  - `prompts/` - Markdown templates for AI prompts
- `.env` - Environment configuration (gitignored)

## Node Naming Convention

When using `--rename` or `--rename-only`:
- Function nodes are renamed to match their TypeScript file names
- Format: lowercase with spaces (e.g., `presence.ts` → `presence`)
- Examples:
  - `cache-house-state.ts` → `cache house state`
  - `filter-hidden-and-domains.ts` → `filter hidden and domains`
  - Generic names like "function" are replaced with descriptive names