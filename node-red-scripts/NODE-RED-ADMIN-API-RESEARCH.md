# Node-RED Admin API Research: Updating Flows Without Restart

## Overview

This document summarizes research into Node-RED Admin API methods for updating individual flows or function nodes without requiring a full addon restart.

## Node-RED Admin API Endpoints

### 1. POST /flows - Primary Flow Deployment Endpoint

The main endpoint for updating flows with different deployment strategies:

```bash
POST /flows
Headers:
  - Content-Type: application/json
  - Node-RED-Deployment-Type: <type>
  - Node-RED-API-Version: v2 (optional)
```

### 2. Deployment Types

The `Node-RED-Deployment-Type` header controls how flows are deployed:

#### **full** (default)
- Stops all existing nodes before starting new configuration
- Complete restart of all flows
- Most disruptive option

#### **nodes** 
- Only stops and restarts nodes that have been modified
- Minimal disruption to unchanged nodes
- Ideal for updating individual function nodes

#### **flows**
- Only stops and restarts flows containing modified nodes
- Good for updating entire flows without affecting others

#### **reload**
- Reloads flows from storage and restarts all nodes
- Available since Node-RED 0.12.2
- Does NOT require Node-RED server restart

### 3. API Usage Examples

#### Update Individual Function Node (Minimal Disruption)
```bash
# 1. Get current flows
GET /flows

# 2. Modify specific function node in the response
# Update the "func" property of the target node

# 3. Deploy with nodes type (only restart modified nodes)
curl -X POST http://localhost:1880/flows \
  -H "Content-Type: application/json" \
  -H "Node-RED-Deployment-Type: nodes" \
  -d @updated-flows.json
```

#### Update Specific Flow
```bash
# 1. Get specific flow
GET /flow/:id

# 2. Update nodes in that flow

# 3. Update the flow
PUT /flow/:id
```

#### Hot Reload All Flows
```bash
curl -X POST http://localhost:1880/flows \
  -H "Content-Type: application/json" \
  -H "Node-RED-Deployment-Type: reload" \
  -d @flows.json
```

## Current Implementation Analysis

Looking at the existing deployment script (`/Volumes/config/node-red-scripts/src/deploy/deploy.ts`):

1. **Current Approach**: 
   - Directly modifies `flows.json` file
   - Attempts to restart entire Node-RED addon via Home Assistant API
   - No use of Node-RED Admin API

2. **Limitations**:
   - Requires full addon restart
   - All flows are disrupted
   - Takes several seconds to complete

## Recommended Implementation

### Option 1: Use Node-RED Admin API with "nodes" Deployment

```typescript
async deployViaAdminAPI(nodeUpdates: Map<string, string>) {
  // 1. Get current flows
  const response = await fetch(`${NODE_RED_URL}/flows`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  const flows = await response.json();
  
  // 2. Update specific nodes
  for (const [nodeId, newCode] of nodeUpdates) {
    const node = flows.find(n => n.id === nodeId);
    if (node && node.type === 'function') {
      node.func = newCode;
    }
  }
  
  // 3. Deploy with minimal disruption
  await fetch(`${NODE_RED_URL}/flows`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Node-RED-Deployment-Type': 'nodes',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify(flows)
  });
}
```

### Option 2: Use WebSocket for Real-time Updates

Node-RED uses WebSocket connections for the editor. While not officially documented for external use, the WebSocket endpoint at `/comms` could potentially be used for real-time updates.

### Option 3: Third-party Modules

- **node-red-contrib-flow-manager**: Provides REST API for runtime flow management
  - POST `/flow-manager/states` with actions like `reloadOnly`
  - Allows loading/unloading flows without full restart

## Implementation Recommendations

1. **Immediate Improvement**: Modify the existing deploy script to use Node-RED Admin API with "nodes" deployment type instead of restarting the addon

2. **API Access**: For Home Assistant addon, you'll need to:
   - Enable ingress in addon configuration
   - Use appropriate authentication (may require HA token passthrough)
   - Or access Node-RED directly on port 1880 if available

3. **Deployment Strategy**:
   - Use "nodes" type for individual function updates
   - Use "flows" type when updating multiple nodes in same flow
   - Use "reload" only when necessary (e.g., configuration changes)

## Benefits

1. **Faster Deployment**: No addon restart needed
2. **Minimal Disruption**: Only modified nodes are restarted
3. **Better Development Experience**: Near-instant updates
4. **Maintains State**: Unmodified flows continue running

## Challenges

1. **Authentication**: Home Assistant addon may require special handling
2. **API Access**: Ingress configuration may limit API access
3. **Version Compatibility**: API features may vary by Node-RED version

## Next Steps

1. Test Node-RED Admin API access through Home Assistant addon
2. Implement proof-of-concept using "nodes" deployment type
3. Update deployment script to use API instead of file manipulation + restart
4. Consider implementing WebSocket support for real-time updates