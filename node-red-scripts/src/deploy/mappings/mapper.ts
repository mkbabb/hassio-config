import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface FunctionNode {
  id: string;
  name: string;
  func: string;
  z: string;
}

interface FlowNode {
  id: string;
  label?: string;
  type: string;
}

interface Mapping {
  nodeId: string;
  nodeName: string;
  tsFile: string;
  distFile: string;
  flowId: string;
  flowName?: string;
  confidence: 'exact' | 'high' | 'medium' | 'low' | 'none';
}

function normalizeCode(code: string): string {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, '') // Remove block comments
    .replace(/\/\/.*$/gm, '') // Remove line comments  
    .replace(/\s+/g, ' ') // Normalize whitespace
    .replace(/\s*([{}();,])\s*/g, '$1') // Remove spaces around punctuation
    .replace(/return msg;?$/g, '') // Remove Node-RED footer
    .trim();
}

function getCodeHash(code: string): string {
  return crypto.createHash('md5').update(normalizeCode(code)).digest('hex');
}

export async function mapFunctions(
  flowsPath?: string,
  distDir?: string, 
  srcDir?: string
): Promise<Mapping[]> {
  // Use defaults if not provided
  flowsPath = flowsPath || process.env.NODE_RED_FLOWS_PATH || '/Volumes/addon_configs/a0d7b954_nodered/flows.json';
  distDir = distDir || path.join(__dirname, '../../../dist');
  srcDir = srcDir || path.join(__dirname, '../../../src');
  
  // Load flows
  const flows = JSON.parse(fs.readFileSync(flowsPath, 'utf8'));
  
  // Extract function nodes
  const functionNodes: FunctionNode[] = flows
    .filter((node: any) => node.type === 'function')
    .map((node: any) => ({
      id: node.id,
      name: node.name || 'unnamed',
      func: node.func || '',
      z: node.z
    }));
    
  // Get flow names
  const flowMap = new Map<string, string>();
  flows
    .filter((node: any) => node.type === 'tab' || node.type === 'subflow')
    .forEach((flow: FlowNode) => {
      flowMap.set(flow.id, flow.label || flow.type);
    });
  
  // Build dist file hash map
  const distHashes = new Map<string, string>();
  const distToSrc = new Map<string, string>();
  
  function scanDir(dir: string, baseDir: string) {
    const files = fs.readdirSync(dir);
    for (const file of files) {
      const fullPath = path.join(dir, file);
      const stat = fs.statSync(fullPath);
      
      if (stat.isDirectory()) {
        scanDir(fullPath, baseDir);
      } else if (file.endsWith('.js')) {
        const content = fs.readFileSync(fullPath, 'utf8');
        const hash = getCodeHash(content);
        const relativePath = path.relative(baseDir, fullPath);
        distHashes.set(hash, relativePath);
        
        // Map to source TypeScript file
        const tsPath = relativePath.replace(/\.js$/, '.ts').replace(/^dist\//, 'src/');
        if (fs.existsSync(path.join(baseDir, '..', tsPath))) {
          distToSrc.set(relativePath, tsPath);
        }
      }
    }
  }
  
  scanDir(distDir, distDir);
  
  // Map function nodes to files
  const mappings: Mapping[] = [];
  
  for (const node of functionNodes) {
    const nodeHash = getCodeHash(node.func);
    const distFile = distHashes.get(nodeHash);
    
    if (distFile) {
      // Exact match found
      const tsFile = distToSrc.get(distFile);
      mappings.push({
        nodeId: node.id,
        nodeName: node.name,
        tsFile: tsFile || 'unknown',
        distFile,
        flowId: node.z,
        flowName: flowMap.get(node.z),
        confidence: 'exact'
      });
    } else {
      // Try to find by source file comment
      const sourceMatch = node.func.match(/\/\/\s*(?:src\/)?(.+\.ts)/);
      if (sourceMatch) {
        const tsFile = sourceMatch[1].startsWith('src/') ? sourceMatch[1] : `src/${sourceMatch[1]}`;
        mappings.push({
          nodeId: node.id,
          nodeName: node.name,
          tsFile,
          distFile: tsFile.replace(/^src\//, 'dist/').replace(/\.ts$/, '.js'),
          flowId: node.z,
          flowName: flowMap.get(node.z),
          confidence: 'high'
        });
      } else {
        // Try name-based matching by searching all directories
        const normalizedName = node.name.replace(/\s+/g, '-').toLowerCase();
        let found = false;
        
        // Search for possible TypeScript files
        function searchForFile(dir: string, baseName: string): string | null {
          const files = fs.readdirSync(dir);
          for (const file of files) {
            const fullPath = path.join(dir, file);
            const stat = fs.statSync(fullPath);
            
            if (stat.isDirectory() && !file.startsWith('.') && file !== 'node_modules') {
              const result = searchForFile(fullPath, baseName);
              if (result) return result;
            } else if (file === `${baseName}.ts` || file === normalizedName + '.ts') {
              return path.relative(srcDir, fullPath);
            }
          }
          return null;
        }
        
        const foundPath = searchForFile(srcDir, normalizedName);
        if (foundPath) {
          mappings.push({
            nodeId: node.id,
            nodeName: node.name,
            tsFile: `src/${foundPath}`,
            distFile: `dist/${foundPath.replace(/\.ts$/, '.js')}`,
            flowId: node.z,
            flowName: flowMap.get(node.z),
            confidence: 'medium'
          });
          found = true;
        }
        
        if (!found) {
          mappings.push({
            nodeId: node.id,
            nodeName: node.name,
            tsFile: 'unmapped',
            distFile: 'unmapped',
            flowId: node.z,
            flowName: flowMap.get(node.z),
            confidence: 'none'
          });
        }
      }
    }
  }
  
  return mappings;
}

import { reconcileUnmappedFunctions, exportReconciliationResults } from '../reconcile';

export async function generateMappingFile(
  options: { 
    useAI?: boolean;
    flowsPath?: string;
    distDir?: string;
    srcDir?: string;
  } = {}
): Promise<void> {
  const mappings = await mapFunctions(options.flowsPath, options.distDir, options.srcDir);
  
  // Load flows to get function nodes for code preview
  const flowsPath = options.flowsPath || process.env.NODE_RED_FLOWS_PATH || '/Volumes/addon_configs/a0d7b954_nodered/flows.json';
  const flows = JSON.parse(fs.readFileSync(flowsPath, 'utf8'));
  const functionNodes = flows
    .filter((node: any) => node.type === 'function')
    .map((node: any) => ({
      id: node.id,
      name: node.name || 'unnamed',
      func: node.func || ''
    }));
  
  // Group by confidence
  const exact = mappings.filter(m => m.confidence === 'exact');
  const high = mappings.filter(m => m.confidence === 'high');
  const medium = mappings.filter(m => m.confidence === 'medium');
  const unmapped = mappings.filter(m => m.confidence === 'none');
  
  const config = {
    generated: new Date().toISOString(),
    stats: {
      total: mappings.length,
      exact: exact.length,
      high: high.length,
      medium: medium.length,
      unmapped: unmapped.length
    },
    mappings: mappings.reduce((acc, m) => {
      if (m.confidence !== 'none') {
        acc[m.tsFile] = acc[m.tsFile] || [];
        acc[m.tsFile].push({
          nodeId: m.nodeId,
          nodeName: m.nodeName,
          flowId: m.flowId,
          flowName: m.flowName
        });
      }
      return acc;
    }, {} as Record<string, any[]>),
    unmapped: unmapped.map(m => ({
      nodeId: m.nodeId,
      nodeName: m.nodeName,
      flowId: m.flowId,
      flowName: m.flowName,
      codePreview: functionNodes.find(n => n.id === m.nodeId)?.func.substring(0, 200) + '...'
    }))
  };
  
  const mappingsDir = __dirname;  // Current directory is mappings
  if (!fs.existsSync(mappingsDir)) {
    fs.mkdirSync(mappingsDir, { recursive: true });
  }
  
  fs.writeFileSync(
    path.join(mappingsDir, 'node-mappings.json'),
    JSON.stringify(config, null, 2)
  );
  
  console.log(`\nMapping Summary:`);
  console.log(`  Total functions: ${mappings.length}`);
  console.log(`  Exact matches: ${exact.length}`);
  console.log(`  High confidence: ${high.length}`);
  console.log(`  Medium confidence: ${medium.length}`);
  console.log(`  Unmapped: ${unmapped.length}`);
  
  if (unmapped.length > 0) {
    console.log(`\nUnmapped functions need manual review:`);
    unmapped.forEach(m => {
      console.log(`  - ${m.nodeName} (${m.nodeId}) in ${m.flowName}`);
    });
    console.log('\nRun with --ai flag to attempt AI reconciliation');
  }
  
  // AI reconciliation for unmapped functions
  if (unmapped.length > 0 && options.useAI) {
    console.log(`\nStarting AI reconciliation for ${unmapped.length} unmapped functions...`);
    
    // Transform unmapped items to the format needed for reconciliation
    const unmappedNodes = config.unmapped.map(u => ({
      id: u.nodeId,
      name: u.nodeName,
      func: u.codePreview?.replace('...', '') || '', // Get the code preview
      flowId: u.flowId,
      flowName: u.flowName
    }));
    
    // Need to get full function code for unmapped nodes
    const flowsPath = options.flowsPath || process.env.NODE_RED_FLOWS_PATH || '/Volumes/addon_configs/a0d7b954_nodered/flows.json';
    const flows = JSON.parse(fs.readFileSync(flowsPath, 'utf8'));
    
    // Update with full function code
    unmappedNodes.forEach(node => {
      const flowNode = flows.find((n: any) => n.id === node.id);
      if (flowNode && flowNode.func) {
        node.func = flowNode.func;
      }
    });
    
    const srcDir = options.srcDir || path.join(__dirname, '../../../src');
    const results = await reconcileUnmappedFunctions(
      unmappedNodes.filter(n => n.func), // Only process nodes with function code
      srcDir,
      config.mappings
    );
    
    // Export results - this will update node-mappings.json and create reconcile-results.json
    exportReconciliationResults(results, path.join(mappingsDir, 'node-mappings.json'));
  }
}