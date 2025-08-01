import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface NodeMapping {
  nodeId: string;
  nodeName: string;
  tsFile: string;
  confidence: string;
}

interface FunctionNode {
  id: string;
  type: string;
  name?: string;
  func?: string;
  z?: string;
  [key: string]: any;
}

/**
 * Convert file path to a consistent node name
 * Examples:
 * - src/presence/presence.ts -> presence
 * - src/cache-states/cache-house-state.ts -> cache house state
 * - src/get-domain-entities/filter-hidden-and-domains.ts -> filter hidden and domains
 * - src/schedules/index.ts -> schedules
 */
function filePathToNodeName(filePath: string): string {
  // Handle 'unmapped' case
  if (filePath === 'unmapped' || filePath === 'unknown' || !filePath) {
    return 'unknown';
  }
  
  // Remove src/ prefix and .ts extension
  const cleanPath = filePath
    .replace(/^src\//, '')
    .replace(/\.ts$/, '');
  
  // Get the filename
  const fileName = path.basename(cleanPath);
  
  // If the file is named 'index', use the parent directory name
  if (fileName === 'index') {
    const parentDir = path.basename(path.dirname(cleanPath));
    return parentDir
      .replace(/-/g, ' ') // Replace hyphens with spaces
      .toLowerCase(); // Convert to lowercase
  }
  
  // Convert to readable format - lowercase with spaces
  return fileName
    .replace(/-/g, ' ') // Replace hyphens with spaces
    .toLowerCase(); // Convert to lowercase
}

/**
 * Get suggested renames for function nodes based on their mappings
 */
export async function getSuggestedRenames(mappingsPath?: string): Promise<Map<string, string>> {
  const defaultPath = path.join(__dirname, 'mappings', 'node-mappings.json');
  const mappingsFile = mappingsPath || defaultPath;
  
  // Check for AI-enhanced mappings first
  const aiEnhancedPath = mappingsFile.replace('.json', '-ai-enhanced.json');
  const finalMappingsPath = fs.existsSync(aiEnhancedPath) ? aiEnhancedPath : mappingsFile;
  
  if (!fs.existsSync(finalMappingsPath)) {
    throw new Error(`Mappings file not found: ${finalMappingsPath}`);
  }
  
  const mappingsData = JSON.parse(fs.readFileSync(finalMappingsPath, 'utf8'));
  const renames = new Map<string, string>();
  
  // Process regular mappings
  if (mappingsData.mappings) {
    for (const [tsFile, nodes] of Object.entries(mappingsData.mappings)) {
      // Skip unknown or invalid mappings
      if (tsFile === 'unknown' || tsFile === 'unmapped' || !tsFile) {
        continue;
      }
      
      const suggestedName = filePathToNodeName(tsFile);
      
      for (const node of nodes as NodeMapping[]) {
        // Check if current name differs from suggested name
        if (node.nodeName !== suggestedName) {
          renames.set(node.nodeId, suggestedName);
        }
      }
    }
  }
  
  return renames;
}

/**
 * Apply renames to function nodes in flows
 */
export async function renameFunctionNodes(
  options: {
    dryRun?: boolean;
    nodeIds?: string[];
    apiUrl?: string;
    auth?: { username: string; password: string };
  } = {}
): Promise<{
  success: boolean;
  renamed: Array<{ nodeId: string; oldName: string; newName: string }>;
  failed: Array<{ nodeId: string; error: string }>;
  error?: string;
}> {
  const { dryRun = false, nodeIds, apiUrl = process.env.NODE_RED_URL || 'http://homeassistant.local:1880', auth } = options;
  
  try {
    // Get suggested renames
    const suggestedRenames = await getSuggestedRenames();
    
    // Filter by specific node IDs if provided
    const renameEntries = nodeIds 
      ? Array.from(suggestedRenames.entries()).filter(([id]) => nodeIds.includes(id))
      : Array.from(suggestedRenames.entries());
    
    if (renameEntries.length === 0) {
      return {
        success: true,
        renamed: [],
        failed: []
      };
    }
    
    // Get current flows
    const { default: fetch } = await import('node-fetch');
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Node-RED-API-Version': 'v2'
    };
    
    if (auth) {
      const basicAuth = Buffer.from(`${auth.username}:${auth.password}`).toString('base64');
      headers['Authorization'] = `Basic ${basicAuth}`;
    }
    
    const flowsResponse = await fetch(`${apiUrl}/flows`, { headers });
    
    if (!flowsResponse.ok) {
      throw new Error(`Failed to fetch flows: ${flowsResponse.status} ${flowsResponse.statusText}`);
    }
    
    const flowsData = await flowsResponse.json();
    const flows = Array.isArray(flowsData) ? flowsData : flowsData.flows || [];
    const renamed: Array<{ nodeId: string; oldName: string; newName: string }> = [];
    const failed: Array<{ nodeId: string; error: string }> = [];
    
    // Apply renames
    let modified = false;
    for (const [nodeId, newName] of renameEntries) {
      const node = flows.find(n => n.id === nodeId);
      
      if (!node) {
        failed.push({ nodeId, error: 'Node not found in flows' });
        continue;
      }
      
      if (node.type !== 'function') {
        failed.push({ nodeId, error: 'Node is not a function node' });
        continue;
      }
      
      const oldName = node.name || 'unnamed';
      renamed.push({ nodeId, oldName, newName });
      
      if (!dryRun) {
        node.name = newName;
        modified = true;
      }
    }
    
    // Deploy changes if not dry run and something was modified
    if (!dryRun && modified) {
      console.log('Deploying renamed nodes...');
      
      const deployResponse = await fetch(`${apiUrl}/flows`, {
        method: 'POST',
        headers: {
          ...headers,
          'Node-RED-Deployment-Type': 'nodes' // Only restart modified nodes
        },
        body: JSON.stringify({
          flows: flows
        })
      });
      
      if (!deployResponse.ok) {
        throw new Error(`Failed to deploy changes: ${deployResponse.status} ${deployResponse.statusText}`);
      }
      
      console.log('✓ Function nodes renamed successfully');
    }
    
    return {
      success: true,
      renamed,
      failed
    };
    
  } catch (error) {
    return {
      success: false,
      renamed: [],
      failed: [],
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

/**
 * CLI interface for renaming nodes
 */
export async function renameCommand(args: {
  dryRun?: boolean;
  nodeIds?: string[];
  verbose?: boolean;
}): Promise<void> {
  const { dryRun = false, nodeIds, verbose = false } = args;
  
  console.log(dryRun ? 'Preview mode - no changes will be made' : 'Renaming function nodes...');
  
  const auth = process.env.HA_USERNAME && process.env.HA_PASSWORD
    ? { username: process.env.HA_USERNAME, password: process.env.HA_PASSWORD }
    : undefined;
  
  const result = await renameFunctionNodes({
    dryRun,
    nodeIds,
    auth
  });
  
  if (!result.success) {
    console.error(`✗ Rename failed: ${result.error}`);
    process.exit(1);
  }
  
  if (result.renamed.length === 0) {
    console.log('No nodes need renaming');
    return;
  }
  
  console.log(`\n${dryRun ? 'Would rename' : 'Renamed'} ${result.renamed.length} function node(s):`);
  
  for (const { nodeId, oldName, newName } of result.renamed) {
    console.log(`  ${oldName} → ${newName}`);
    if (verbose) {
      console.log(`    Node ID: ${nodeId}`);
    }
  }
  
  if (result.failed.length > 0) {
    console.log(`\nFailed to rename ${result.failed.length} node(s):`);
    for (const { nodeId, error } of result.failed) {
      console.log(`  ${nodeId}: ${error}`);
    }
  }
}