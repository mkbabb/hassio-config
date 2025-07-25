# Node-RED TypeScript Deployment Guide

This guide explains how to use the automated deployment system for Node-RED with Home Assistant addon support.

## Overview

The deployment system provides:
- **Dual mode support**: Works with both standalone Node-RED and Home Assistant addon installations
- **Automatic discovery**: Finds and matches TypeScript source files with Node-RED function nodes
- **Smart matching**: Uses multiple strategies (exact, normalized, similarity) to match code
- **Comprehensive mapping**: Handles flows, subflows, and all function nodes

## Quick Start

### 1. Initial Setup

```bash
# Install dependencies
npm install

# Build TypeScript files
npm run build
```

### 2. Discover Function Mappings

Run the discovery tool to automatically map Node-RED functions to TypeScript sources:

```bash
# Basic discovery
npm run discover

# Verbose output
npm run discover:verbose

# Analyze a specific node
npm run discover:analyze -- <node-id>
```

This will generate:
- `deployment.config.json` - Deployment configuration with all mappings
- `deployment-plan.md` - Detailed plan for manual mapping of unmatched nodes

### 3. Review and Complete Mappings

Open `deployment-plan.md` to see:
- Successfully matched nodes and their confidence levels
- Unmatched nodes requiring manual mapping
- Suggested matches based on name similarity

For unmatched nodes, edit `deployment.config.json` and add manual mappings:

```json
{
  "nodeMapping": {
    "node-id-here": {
      "sourceFile": "path/to/source.ts",
      "nodeInfo": {
        "name": "Function Name",
        "flowTab": "Flow Name"
      }
    }
  }
}
```

### 4. Test Connection

Before deploying, test your connection:

```bash
# Auto-detect mode
npm run test:connection

# Home Assistant addon mode
npm run test:connection -- -m ha-addon -t YOUR_TOKEN

# Standalone mode
npm run test:connection -- -m standalone -u http://localhost:1880
```

### 5. Deploy

Deploy your TypeScript functions to Node-RED:

```bash
# Dry run (preview changes)
npm run deploy:dry-run

# Deploy with auto-detected mode
npm run deploy

# Deploy to Home Assistant addon
npm run deploy:ha -- -m ha-addon

# Deploy to standalone Node-RED
npm run deploy:standalone
```

## Configuration

### Environment Variables

Create a `.env` file based on `.env.example`:

```bash
# Deployment Mode
NODE_RED_MODE=auto  # auto, standalone, ha-addon

# Standalone Mode
NODE_RED_URL=http://localhost:1880
NODE_RED_USERNAME=admin
NODE_RED_PASSWORD=password

# Home Assistant Addon Mode
HA_URL=http://homeassistant.local:8123
HA_TOKEN=YOUR_LONG_LIVED_ACCESS_TOKEN
HA_ADDON_SLUG=a0d7b954_nodered
```

### Home Assistant Long-Lived Access Token

To create a token for Home Assistant:
1. Go to your Home Assistant profile
2. Scroll to "Long-Lived Access Tokens"
3. Click "Create Token"
4. Give it a name and copy the token

## Deployment Workflow

### Complete Workflow Example

```bash
# 1. Clean build
npm run build

# 2. Discover mappings
npm run discover

# 3. Review the plan
cat deployment-plan.md

# 4. Test connection
npm run test:connection

# 5. Dry run deployment
npm run deploy:dry-run

# 6. Deploy
npm run deploy
```

### Working with Specific Nodes

```bash
# Analyze a specific node
npm run discover:analyze -- 55653f952629f321

# Deploy a specific file
npm run deploy:helper -- deploy src/presence/presence.ts

# Check sync status
npm run deploy:sync
```

## Matching Algorithm

The discovery system uses three phases to match functions:

1. **Exact Match**: Compares MD5 hashes of the code
2. **Normalized Match**: Removes comments, whitespace, and formatting differences
3. **Similarity Match**: Uses Levenshtein distance for >80% similarity

### Match Confidence Levels

- **100%**: Exact byte-for-byte match
- **95%**: Normalized match (formatting differences only)
- **80-94%**: High similarity (minor code changes)
- **<80%**: Requires manual verification

## Troubleshooting

### Connection Issues

**Home Assistant Addon**
- Ensure your long-lived access token is valid
- Check the addon slug matches your installation
- Verify ingress is enabled in the addon configuration

**Standalone Mode**
- Ensure Node-RED is accessible at the specified URL
- Check authentication credentials if required

### Matching Issues

**No matches found**
- Ensure TypeScript files are built (`npm run build`)
- Check that compiled files exist in the `dist` directory
- Review code differences that might prevent matching

**Low confidence matches**
- Compare the Node-RED function with the TypeScript source
- Look for added debugging code or modifications
- Consider updating the TypeScript source to match

### Deployment Failures

**"Node not found"**
- The node ID in the mapping doesn't exist in Node-RED
- Re-run discovery to update mappings

**"Failed to deploy"**
- Check Node-RED logs for errors
- Ensure the user has appropriate permissions
- Verify the Node-RED API is accessible

## Advanced Usage

### Custom Build and Deploy

```typescript
import { EnhancedNodeRedDeployer } from './src/api/deploy-config.js';

const deployer = new EnhancedNodeRedDeployer({
    mode: 'ha-addon',
    api: {
        haToken: 'your-token-here'
    }
});

// Deploy a specific file
await deployer.deployFile('src/presence/presence.ts');

// Deploy all mapped files
await deployer.deployAll();
```

### Programmatic Discovery

```typescript
import { DeploymentDiscovery } from './src/api/deployment-discovery.js';

const discovery = new DeploymentDiscovery('src', 'dist');
const mapping = await discovery.discoverMappings();

console.log(`Found ${mapping.matched.length} matches`);
console.log(`${mapping.unmatched.nodes.length} nodes need manual mapping`);
```

## Best Practices

1. **Version Control**: Commit `deployment.config.json` to track mappings
2. **Regular Discovery**: Re-run discovery after adding new functions
3. **Code Comments**: Add identifying comments to help match functions
4. **Consistent Naming**: Use similar names in TypeScript and Node-RED
5. **Test First**: Always run dry-run before actual deployment

## API Reference

See the [API documentation](src/api/README.md) for detailed information about:
- NodeRedClient methods
- EnhancedNodeRedDeployer API
- DeploymentDiscovery functions
- Configuration options