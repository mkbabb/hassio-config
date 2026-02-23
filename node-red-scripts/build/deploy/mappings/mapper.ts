/**
 * Node-RED Function Mapping System
 *
 * Maps Node-RED function nodes to TypeScript source files using hash-based matching
 * and AI reconciliation. Critical for the deployment system to know which source file
 * corresponds to which function node.
 *
 * Mapping strategies (in order):
 * 1. **Hash matching**: MD5 hash of normalized code matches dist file
 *    - Removes comments, whitespace, and "return msg;" footer
 *    - 100% accuracy when code hasn't changed
 * 2. **Collision resolution**: Multiple files with same hash (rare)
 *    - Uses name similarity scoring to pick best match
 *    - Confidence downgraded to 'high'
 * 3. **AI reconciliation**: GPT-5 semantic matching for unmapped functions
 *    - Analyzes function code and available source files
 *    - Requires 75%+ confidence for acceptance
 *    - Incremental saving prevents re-processing
 *
 * Source comment matching was REMOVED (broken by esbuild bundling):
 * - esbuild inlines dependencies with "// src/*.ts" comments
 * - Regex would match FIRST comment = always a utility dependency (wrong!)
 * - Now relies exclusively on hash matching + AI reconciliation
 *
 * Confidence levels:
 * - 'exact': Single hash match, verified source file exists
 * - 'high': Hash collision resolved by name similarity
 * - 'orphaned': Compiled JS exists but source TS missing (manual reconciliation needed)
 * - 'none': No hash match, needs AI reconciliation
 *
 * Output format (node-mappings.json):
 * ```json
 * {
 *   "mappings": {
 *     "src/presence/presence.ts": [
 *       { "nodeId": "abc123", "nodeName": "presence", "flowId": "def456", "flowName": "Presence Subflow" }
 *     ]
 *   },
 *   "orphaned": [...],
 *   "unmapped": [...]
 * }
 * ```
 *
 * @module build/deploy/mappings/mapper
 *
 * @example
 * // Generate mappings without AI:
 * await generateMappingFile();
 *
 * // Generate with AI reconciliation:
 * await generateMappingFile({ useAI: true });
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { fileURLToPath } from 'node:url';
import { StyleHelper } from '../../style';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Represents a Node-RED function node from flows.json.
 */
interface FunctionNode {
  id: string;        // Unique node identifier
  name: string;      // Display name in Node-RED
  func: string;      // JavaScript function code
  z: string;         // Parent flow/subflow ID
}

/**
 * Represents a Node-RED flow or subflow container.
 */
interface FlowNode {
  id: string;
  label?: string;    // For regular flows (tabs)
  name?: string;     // For subflows
  type: string;      // 'tab' or 'subflow'
}

/**
 * Mapping between a Node-RED function node and its TypeScript source file.
 */
interface Mapping {
  nodeId: string;          // Node-RED function node ID
  nodeName: string;        // Node-RED function node name
  tsFile: string;          // Source TypeScript file path (or 'unmapped'/'orphaned')
  distFile: string;        // Compiled JavaScript file path
  flowId: string;          // Parent flow/subflow ID
  flowName?: string;       // Parent flow/subflow name
  confidence: 'exact' | 'high' | 'orphaned' | 'none';
}

/**
 * Normalizes JavaScript code for hash comparison.
 *
 * Normalization steps:
 * 1. Remove block comments (/* ... *\/)
 * 2. Remove line comments (// ...)
 * 3. Collapse all whitespace to single spaces
 * 4. Remove spaces around punctuation ({}();,)
 * 5. Remove "return msg;" footer (Node-RED standard)
 * 6. Convert to lowercase for case-insensitive comparison
 *
 * Edge case: If normalization results in empty string, use original code
 * to prevent hash collisions between different empty/placeholder functions.
 *
 * @param code - Raw JavaScript code
 * @returns Normalized code suitable for hashing
 *
 * @example
 * normalizeCode("  // Comment\n  return msg;  ")
 * // Returns: ""
 *
 * normalizeCode("console.log('test'); return msg;")
 * // Returns: "console.log('test');"
 */
function normalizeCode(code: string): string {
  const normalized = code
    .replace(/\/\*[\s\S]*?\*\//g, '') // Remove block comments
    .replace(/\/\/.*$/gm, '') // Remove line comments  
    .replace(/\s+/g, ' ') // Normalize whitespace
    .replace(/\s*([{}();,])\s*/g, '$1') // Remove spaces around punctuation
    .replace(/return\s+msg\s*;?\s*$/g, '') // Remove Node-RED footer with flexible whitespace
    .trim()
    .toLowerCase(); // Convert to lowercase for consistent comparison
  
  // If normalization results in empty string, use original code for hashing
  // This prevents hash collisions between different empty/placeholder functions
  if (normalized === '') {
    return code.trim().toLowerCase();
  }
  
  return normalized;
}

/**
 * Generates MD5 hash of normalized code.
 * Used for matching Node-RED function code to dist files.
 *
 * @param code - Raw JavaScript code
 * @returns 32-character hexadecimal MD5 hash
 *
 * @example
 * getCodeHash("console.log('test'); return msg;")
 * // Returns: "a1b2c3d4e5f6..." (32 chars)
 */
function getCodeHash(code: string): string {
  return crypto.createHash('md5').update(normalizeCode(code)).digest('hex');
}

/**
 * Detects placeholder/utility nodes that should not be mapped.
 *
 * Placeholder characteristics:
 * - Contains "should not be deployed" comment
 * - Contains "utility module" comment
 * - Normalized code < 100 characters (minimal/stub code)
 *
 * These nodes are typically created as placeholders or represent utility
 * modules that were mistakenly added as Node-RED functions.
 *
 * @param code - Raw function node code
 * @returns true if node is a placeholder, false otherwise
 *
 * @example
 * isPlaceholderNode("// This file appears to be a utility module\nreturn msg;")
 * // Returns: true
 *
 * isPlaceholderNode("const result = msg.payload.filter(x => x.state === 'on'); return msg;")
 * // Returns: false
 */
function isPlaceholderNode(code: string): boolean {
  // Check for explicit utility/placeholder comments
  if (code.includes('should not be deployed') || code.includes('utility module')) {
    return true;
  }

  // Check if normalized code is too short (< 100 chars = likely stub/empty)
  const normalized = normalizeCode(code);
  if (normalized.length < 100) {
    return true;
  }

  return false;
}

/**
 * Maps Node-RED function nodes to TypeScript source files.
 *
 * Process:
 * 1. Load flows.json and extract function nodes
 * 2. Build flow name map (tabs and subflows)
 * 3. Scan dist directory and hash all JS files
 * 4. For each function node:
 *    a. Calculate hash of node code
 *    b. Look for matching dist file hash
 *    c. If single match: exact mapping (confidence: 'exact')
 *    d. If multiple matches: resolve by name similarity (confidence: 'high')
 *    e. If no match: mark unmapped (confidence: 'none')
 *    f. If dist exists but no source: mark orphaned (confidence: 'orphaned')
 *
 * Hash collision resolution:
 * - Normalizes node name to lowercase kebab-case
 * - Scores each candidate file by name similarity:
 *   - 10 points if filename contains node name
 *   - 5 points if node name contains filename
 *   - 0 points otherwise
 * - Selects highest scoring candidate
 *
 * @param flowsPath - Path to flows.json (default: env NODE_RED_FLOWS_PATH)
 * @param distDir - Compiled JavaScript directory (default: build/../../../dist)
 * @param srcDir - TypeScript source directory (default: build/../../../src)
 * @returns Array of mappings with confidence levels
 *
 * @example
 * const mappings = await mapFunctions();
 * mappings.forEach(m => {
 *   console.log(`${m.nodeName} → ${m.tsFile} (${m.confidence})`);
 * });
 */
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
      // Use appropriate property based on flow type
      const flowName = flow.type === 'subflow' 
        ? (flow.name || flow.type)     // Subflows use 'name' property
        : (flow.label || flow.type);   // Regular flows use 'label' property
      flowMap.set(flow.id, flowName);
    });
  
  // Build dist file hash map with collision detection
  const distHashes = new Map<string, string[]>(); // Hash -> array of file paths
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
        
        // Handle hash collisions by storing arrays of paths
        if (!distHashes.has(hash)) {
          distHashes.set(hash, []);
        }
        distHashes.get(hash)!.push(relativePath);
        
        // Map to source TypeScript file
        const tsPath = relativePath.replace(/\.js$/, '.ts');
        const srcPath = `src/${tsPath}`;
        const fullSrcPath = path.join(baseDir, '..', 'src', tsPath);
        if (fs.existsSync(fullSrcPath)) {
          distToSrc.set(relativePath, srcPath);
        }
      }
    }
  }
  
  console.log(StyleHelper.info(`Scanning dist directory: ${distDir}`));
  scanDir(distDir, distDir);
  const totalFiles = Array.from(distHashes.values()).reduce((sum, files) => sum + files.length, 0);
  console.log(StyleHelper.info(`Found ${totalFiles} JavaScript files in dist (${distHashes.size} unique hashes)`));
  
  // Map function nodes to files
  const mappings: Mapping[] = [];

  for (const node of functionNodes) {
    // Skip placeholder/utility nodes - they should not be mapped
    if (isPlaceholderNode(node.func)) {
      console.log(StyleHelper.colors.muted(`  Skipping placeholder node: "${node.name}" (${node.id})`));
      continue;
    }

    const nodeHash = getCodeHash(node.func);
    const distFiles = distHashes.get(nodeHash);

    if (distFiles && distFiles.length > 0) {
      // Found potential matches
      let bestMatch: string | null = null;
      let confidence: 'exact' | 'high' = 'exact';

      if (distFiles.length === 1) {
        // Single match - exact
        bestMatch = distFiles[0];
      } else {
        // Multiple matches (hash collision) - resolve via name similarity
        console.log(StyleHelper.warning(`Hash collision detected for node "${node.name}"`, `${distFiles.length} candidates`));

        const normalizedNodeName = node.name.replace(/\s+/g, '-').toLowerCase();
        const candidateScores = distFiles.map(file => {
          const fileName = path.basename(file, '.js').toLowerCase();
          const score = fileName.includes(normalizedNodeName) ? 10 :
                       normalizedNodeName.includes(fileName) ? 5 : 0;
          return { file, score };
        });

        const bestCandidate = candidateScores.sort((a, b) => b.score - a.score)[0];
        bestMatch = bestCandidate.file;
        confidence = 'high';
        console.log(StyleHelper.colors.muted(`  Best match for "${node.name}": ${bestMatch}`));
      }
      
      const tsFile = distToSrc.get(bestMatch);
      
      if (tsFile) {
        // We have both compiled JS and source TS
        mappings.push({
          nodeId: node.id,
          nodeName: node.name,
          tsFile,
          distFile: bestMatch,
          flowId: node.z,
          flowName: flowMap.get(node.z),
          confidence
        });
      } else {
        // Compiled JS exists but no source TS - orphaned node requiring manual reconciliation
        mappings.push({
          nodeId: node.id,
          nodeName: node.name,
          tsFile: 'orphaned',
          distFile: bestMatch, // Keep the JS file reference for manual reconciliation
          flowId: node.z,
          flowName: flowMap.get(node.z),
          confidence: 'orphaned'
        });
      }
    } else {
      // No hash match - mark as unmapped for AI reconciliation
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
  
  return mappings;
}

import { reconcileUnmappedFunctions, exportReconciliationResults } from '../reconcile';

/**
 * Generates node-mappings.json file with hash-based and AI reconciliation.
 *
 * Output structure:
 * - mappings: Object mapping source files to arrays of mapped nodes
 * - orphaned: Nodes with compiled JS but missing source TS
 * - unmapped: Nodes without matches (pre-AI) or failed AI matches
 * - stats: Summary counts (total, exact, high, orphaned, unmapped)
 *
 * Display sections:
 * 1. Mapping Summary: Total files, built count, cached count, failed count
 * 2. Confidence Levels: Exact matches, high confidence, orphaned, unmapped
 * 3. Shared Functions: Files mapped to multiple nodes (potential reusable functions)
 * 4. Orphaned Functions: Compiled JS exists but source TS missing
 * 5. Unmapped Functions: No hash match, suggests running --ai flag
 * 6. AI Reconciliation: If useAI=true, runs GPT-5 semantic matching
 *
 * AI reconciliation:
 * - Processes unmapped functions in batches (token limit)
 * - Saves mappings incrementally after each successful match
 * - Removes matched files from candidate pool
 * - Exports reconciliation results to reconcile-results.json
 *
 * @param options - Configuration options
 * @param options.useAI - Enable AI reconciliation (default: false)
 * @param options.flowsPath - Path to flows.json
 * @param options.distDir - Compiled JavaScript directory
 * @param options.srcDir - TypeScript source directory
 *
 * @example
 * // Basic mapping (hash-only):
 * await generateMappingFile();
 *
 * // With AI reconciliation:
 * await generateMappingFile({ useAI: true });
 *
 * // Custom paths:
 * await generateMappingFile({
 *   flowsPath: '/custom/flows.json',
 *   distDir: './dist',
 *   srcDir: './src',
 *   useAI: true
 * });
 */
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
  const orphaned = mappings.filter(m => m.confidence === 'orphaned');
  const unmapped = mappings.filter(m => m.confidence === 'none');

  const config = {
    generated: new Date().toISOString(),
    stats: {
      total: mappings.length,
      exact: exact.length,
      high: high.length,
      orphaned: orphaned.length,
      unmapped: unmapped.length
    },
    mappings: mappings.reduce((acc, m) => {
      if (m.confidence !== 'none' && m.confidence !== 'orphaned') {
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
    orphaned: orphaned.map(m => ({
      nodeId: m.nodeId,
      nodeName: m.nodeName,
      flowId: m.flowId,
      flowName: m.flowName,
      orphanedJsFile: m.distFile,
      codePreview: functionNodes.find((n: any) => n.id === m.nodeId)?.func.substring(0, 200) + '...',
      requiresManualReconciliation: true
    })),
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
  
  console.log(StyleHelper.section("Mapping Summary"));
  console.log(StyleHelper.summary({
    total: mappings.length,
    built: exact.length + high.length,
    cached: exact.length,
    failed: orphaned.length + unmapped.length
  }));

  console.log(StyleHelper.info("Confidence levels:"));
  console.log(StyleHelper.colors.success(`  ✓ Exact matches: ${exact.length}`));
  console.log(StyleHelper.colors.success(`  ✓ High confidence: ${high.length}`));
  if (orphaned.length > 0) {
    console.log(StyleHelper.colors.error(`  ⚠ Orphaned: ${orphaned.length}`));
  }
  if (unmapped.length > 0) {
    console.log(StyleHelper.colors.error(`  ✗ Unmapped: ${unmapped.length}`));
  }
  
  // Check for multiple nodes mapped to same file and warn
  const fileNodeCounts = new Map<string, number>();
  mappings.forEach(m => {
    if (m.confidence !== 'none' && m.confidence !== 'orphaned') {
      fileNodeCounts.set(m.tsFile, (fileNodeCounts.get(m.tsFile) || 0) + 1);
    }
  });
  
  const multiNodeFiles = Array.from(fileNodeCounts.entries()).filter(([_, count]) => count > 1);
  if (multiNodeFiles.length > 0) {
    console.log('\n' + StyleHelper.section("Shared Functions"));
    console.log(StyleHelper.colors.muted("Multiple nodes mapped to single files - verify this is intentional for reusable functions"));
    
    multiNodeFiles.forEach(([file, count]) => {
      const nodesForFile = mappings.filter(m => m.tsFile === file);
      const panelContent = [
        StyleHelper.keyValue('File', StyleHelper.colors.bold(file)),
        StyleHelper.keyValue('Count', StyleHelper.colors.italic(count.toString()) + ' nodes'),
        '',
        StyleHelper.colors.muted('Mapped Nodes:'),
        ...nodesForFile.map(node => 
          `  ${StyleHelper.symbols.bullet} ${StyleHelper.colors.bold(node.nodeName)} ${StyleHelper.colors.muted(`• ${node.flowName}`)}`
        )
      ];
      console.log(StyleHelper.panel(panelContent, `${StyleHelper.symbols.warning} Shared Function`));
    });
  }
  
  if (orphaned.length > 0) {
    console.log('\n' + StyleHelper.section("Orphaned Functions"));
    console.log(StyleHelper.colors.muted("Compiled JS exists, source TS missing - requires manual reconciliation"));
    
    orphaned.forEach(m => {
      const orphanContent = [
        StyleHelper.keyValue('Function', StyleHelper.colors.bold(m.nodeName)),
        StyleHelper.keyValue('Node ID', m.nodeId, StyleHelper.colors.muted, StyleHelper.colors.muted),
        StyleHelper.keyValue('Flow', m.flowName || 'Unknown'),
        StyleHelper.keyValue('JS File', m.distFile, StyleHelper.colors.muted, StyleHelper.colors.error),
        '',
        StyleHelper.colors.warning('Manual reconciliation required')
      ];
      console.log(StyleHelper.panel(orphanContent, `${StyleHelper.symbols.error} Orphaned Function`));
    });
  }
  
  if (unmapped.length > 0) {
    console.log('\n' + StyleHelper.section("Unmapped Functions"));
    console.log(StyleHelper.colors.muted("Functions needing manual review or AI reconciliation"));
    
    unmapped.forEach(m => {
      const unmappedContent = [
        StyleHelper.keyValue('Function', StyleHelper.colors.bold(m.nodeName)),
        StyleHelper.keyValue('Node ID', m.nodeId, StyleHelper.colors.muted, StyleHelper.colors.muted),
        StyleHelper.keyValue('Flow', m.flowName || 'Unknown')
      ];
      console.log(StyleHelper.panel(unmappedContent, `${StyleHelper.symbols.warning} Unmapped Function`));
    });
    
    console.log('\n' + StyleHelper.info("Run with --ai flag to attempt AI reconciliation"));
  }
  
  // AI reconciliation for unmapped functions
  if (unmapped.length > 0 && options.useAI) {
    console.log(StyleHelper.section("AI Reconciliation"));
    console.log(StyleHelper.info(`Starting AI reconciliation for ${unmapped.length} unmapped functions`));
    
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
    const mappingsFilePath = path.join(mappingsDir, 'node-mappings.json');

    const {results, cleanedMappings} = await reconcileUnmappedFunctions(
      unmappedNodes.filter(n => n.func),
      srcDir,
      config.mappings,
      mappingsFilePath  // Pass path for incremental saves
    );

    // Export results - this will update node-mappings.json and create reconcile-results.json
    exportReconciliationResults(results, mappingsFilePath, cleanedMappings);
  }
}