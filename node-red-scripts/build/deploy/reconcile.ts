import OpenAI from 'openai';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { config as loadEnv } from 'dotenv';

// Load environment variables
loadEnv();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configuration
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o";
const CONFIDENCE_THRESHOLD = parseInt(process.env.AI_CONFIDENCE_THRESHOLD || '75');
const MAX_TOKENS_PER_REQUEST = 12000; // Conservative limit for context
const MAX_LINES_PER_FILE = 500;

// Initialize OpenAI
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

interface FunctionNode {
  id: string;
  name: string;
  func: string;
  flowId: string;
  flowName?: string;
}

interface FileCandidate {
  path: string;
  content: string;
  lineCount: number;
}

interface MatchResult {
  file: string;
  confidence: number;
  reasoning: string;
}

interface ReconciliationResult {
  nodeId: string;
  nodeName: string;
  selectedFile: string | null;
  confidence: number;
  reasoning: string;
  flowId?: string;
  flowName?: string;
}

/**
 * Load prompt template from markdown file
 */
function loadPrompt(templateName: string, variables: Record<string, string>): string {
  const promptPath = path.join(__dirname, 'mappings', 'prompts', `${templateName}.md`);
  let prompt = fs.readFileSync(promptPath, 'utf8');
  
  // Replace template variables
  for (const [key, value] of Object.entries(variables)) {
    prompt = prompt.replace(new RegExp(`{{${key}}}`, 'g'), value);
  }
  
  return prompt;
}

/**
 * Count tokens approximately (rough estimate: 1 token ≈ 4 characters)
 */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}


/**
 * Get all TypeScript files that haven't been mapped yet
 */
async function getUnmappedTypeScriptFiles(
  srcDir: string,
  mappedFiles: Set<string>
): Promise<FileCandidate[]> {
  const candidates: FileCandidate[] = [];
  
  async function scanDir(dir: string) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const relativePath = path.relative(srcDir, fullPath).replace(/\\/g, '/');
      
      if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
        await scanDir(fullPath);
      } else if (entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) {
        // Skip if already mapped
        if (mappedFiles.has(`src/${relativePath}`)) continue;
        
        const content = fs.readFileSync(fullPath, 'utf8');
        const lineCount = content.split('\n').length;
        
        candidates.push({
          path: `src/${relativePath}`,
          content,
          lineCount
        });
      }
    }
  }
  
  await scanDir(srcDir);
  return candidates;
}

/**
 * Create file chunks for AI analysis based on token limits
 */
function createFileChunks(
  candidates: FileCandidate[],
  maxTokens: number
): FileCandidate[][] {
  const chunks: FileCandidate[][] = [];
  let currentChunk: FileCandidate[] = [];
  let currentTokens = 0;
  
  // Sort by line count (smaller files first for better batching)
  const sorted = [...candidates].sort((a, b) => a.lineCount - b.lineCount);
  
  for (const candidate of sorted) {
    // Truncate large files
    let fileContent = candidate.content;
    if (candidate.lineCount > MAX_LINES_PER_FILE) {
      const lines = fileContent.split('\n').slice(0, MAX_LINES_PER_FILE);
      fileContent = lines.join('\n') + '\n// ... truncated ...';
    }
    
    const fileTokens = estimateTokens(fileContent);
    
    // If single file is too large, give it its own chunk
    if (fileTokens > maxTokens * 0.7) {
      if (currentChunk.length > 0) {
        chunks.push(currentChunk);
        currentChunk = [];
      }
      chunks.push([{ ...candidate, content: fileContent }]);
      currentTokens = 0;
    } else if (currentTokens + fileTokens > maxTokens) {
      // Start new chunk
      chunks.push(currentChunk);
      currentChunk = [{ ...candidate, content: fileContent }];
      currentTokens = fileTokens;
    } else {
      // Add to current chunk
      currentChunk.push({ ...candidate, content: fileContent });
      currentTokens += fileTokens;
    }
  }
  
  if (currentChunk.length > 0) {
    chunks.push(currentChunk);
  }
  
  return chunks;
}

/**
 * Format file list for prompt
 */
function formatFileList(files: FileCandidate[]): string {
  return files.map(f => {
    const preview = f.content.split('\n').slice(0, 50).join('\n');
    return `### ${f.path} (${f.lineCount} lines)
\`\`\`typescript
${preview}
${f.lineCount > 50 ? '// ... truncated ...' : ''}
\`\`\``;
  }).join('\n\n');
}

/**
 * Match a function node against a chunk of files
 */
async function matchFunctionToFiles(
  node: FunctionNode,
  files: FileCandidate[]
): Promise<MatchResult[]> {
  const prompt = loadPrompt('match-function', {
    NODE_NAME: node.name,
    FLOW_NAME: node.flowName || 'Unknown',
    NODE_ID: node.id,
    FUNCTION_CODE: node.func,
    FILE_LIST: formatFileList(files)
  });
  
  try {
    const response = await openai.chat.completions.create({
      model: OPENAI_MODEL,
      messages: [
        { role: 'system', content: 'You are an expert at analyzing code and finding matching implementations.' },
        { role: 'user', content: prompt }
      ],
      temperature: 0.2,
      response_format: { type: 'json_object' }
    });
    
    const result = JSON.parse(response.choices[0].message.content || '{"matches":[]}');
    return result.matches || [];
  } catch (error) {
    console.error(`Error matching function ${node.name}:`, error);
    return [];
  }
}

/**
 * Select the best match from candidates
 */
async function selectBestMatch(
  node: FunctionNode,
  candidates: MatchResult[]
): Promise<ReconciliationResult> {
  if (candidates.length === 0) {
    return {
      nodeId: node.id,
      nodeName: node.name,
      selectedFile: null,
      confidence: 0,
      reasoning: 'No candidates found',
      flowId: node.flowId,
      flowName: node.flowName
    };
  }
  
  // If only one candidate above threshold, use it if confidence is very high
  if (candidates.length === 1 && candidates[0].confidence >= 85) {
    return {
      nodeId: node.id,
      nodeName: node.name,
      selectedFile: candidates[0].file,
      confidence: candidates[0].confidence,
      reasoning: candidates[0].reasoning,
      flowId: node.flowId,
      flowName: node.flowName
    };
  }
  
  // Use AI to select best match
  const candidatesText = candidates.map(c => 
    `- ${c.file}: ${c.confidence}% - ${c.reasoning}`
  ).join('\n');
  
  const prompt = loadPrompt('select-best-match', {
    NODE_NAME: node.name,
    NODE_DESCRIPTION: `Function with ${node.func.split('\n').length} lines of code`,
    THRESHOLD: CONFIDENCE_THRESHOLD.toString(),
    CANDIDATES: candidatesText
  });
  
  try {
    const response = await openai.chat.completions.create({
      model: OPENAI_MODEL,
      messages: [
        { role: 'system', content: 'You are an expert at selecting the best code match. Be very conservative - prefer no match over a wrong match.' },
        { role: 'user', content: prompt }
      ],
      temperature: 0.1,
      response_format: { type: 'json_object' }
    });
    
    const result = JSON.parse(response.choices[0].message.content || '{}');
    return {
      nodeId: node.id,
      nodeName: node.name,
      selectedFile: result.selected_file,
      confidence: result.confidence || 0,
      reasoning: result.reasoning || 'No suitable match found',
      flowId: node.flowId,
      flowName: node.flowName
    };
  } catch (error) {
    console.error(`Error selecting best match for ${node.name}:`, error);
    return {
      nodeId: node.id,
      nodeName: node.name,
      selectedFile: null,
      confidence: 0,
      reasoning: 'Error in selection process',
      flowId: node.flowId,
      flowName: node.flowName
    };
  }
}

/**
 * Reconcile unmapped functions using AI
 * Note: Orphaned nodes (with compiled JS but no source TS) are excluded and require manual reconciliation
 */
export async function reconcileUnmappedFunctions(
  unmappedNodes: FunctionNode[],
  srcDir: string,
  existingMappings: Record<string, any[]>
): Promise<ReconciliationResult[]> {
  console.log(`\nStarting AI reconciliation for ${unmappedNodes.length} unmapped functions...`);
  console.log(`Note: Orphaned nodes (with compiled JS but missing source TS) require manual reconciliation and are excluded from AI processing.`);
  
  // Get set of already mapped files
  const mappedFiles = new Set(Object.keys(existingMappings));
  
  // Get unmapped TypeScript files
  const unmappedFiles = await getUnmappedTypeScriptFiles(srcDir, mappedFiles);
  console.log(`Found ${unmappedFiles.length} unmapped TypeScript files`);
  
  if (unmappedFiles.length === 0) {
    console.log('No unmapped TypeScript files to match against');
    return [];
  }
  
  // Create file chunks
  const fileChunks = createFileChunks(unmappedFiles, MAX_TOKENS_PER_REQUEST);
  console.log(`Created ${fileChunks.length} file chunks for analysis`);
  
  const results: ReconciliationResult[] = [];
  
  // Process each unmapped node
  for (const node of unmappedNodes) {
    console.log(`\nProcessing: ${node.name}`);
    const allMatches: MatchResult[] = [];
    
    // Check against each chunk
    for (let i = 0; i < fileChunks.length; i++) {
      console.log(`  Checking chunk ${i + 1}/${fileChunks.length} (${fileChunks[i].length} files)`);
      const matches = await matchFunctionToFiles(node, fileChunks[i]);
      
      // Filter by confidence threshold
      const goodMatches = matches.filter(m => m.confidence >= CONFIDENCE_THRESHOLD);
      allMatches.push(...goodMatches);
      
      // Early exit if we found a very high confidence match
      if (goodMatches.some(m => m.confidence >= 95)) {
        console.log(`  Found high confidence match, skipping remaining chunks`);
        break;
      }
    }
    
    // Select best match
    const result = await selectBestMatch(node, allMatches);
    results.push(result);
    
    if (result.selectedFile) {
      console.log(`  ✓ Matched to ${result.selectedFile} (${result.confidence}%)`);
    } else {
      console.log(`  ✗ No suitable match found`);
    }
    
    // Add small delay to avoid rate limits
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  
  return results;
}

/**
 * Export reconciliation results
 */
export function exportReconciliationResults(
  results: ReconciliationResult[],
  mappingsPath: string
): void {
  // Read current mappings
  const mappingsData = JSON.parse(fs.readFileSync(mappingsPath, 'utf8'));
  
  // Update mappings with successful matches
  let newMappings = 0;
  for (const result of results) {
    if (result.selectedFile && result.confidence >= CONFIDENCE_THRESHOLD) {
      if (!mappingsData.mappings[result.selectedFile]) {
        mappingsData.mappings[result.selectedFile] = [];
      }
      
      mappingsData.mappings[result.selectedFile].push({
        nodeId: result.nodeId,
        nodeName: result.nodeName,
        flowId: result.flowId,
        flowName: result.flowName,
        confidence: 'ai-reconciled',
        aiConfidence: result.confidence
      });
      
      newMappings++;
    }
  }
  
  // Update stats
  mappingsData.stats.unmapped -= newMappings;
  mappingsData.stats['ai-reconciled'] = (mappingsData.stats['ai-reconciled'] || 0) + newMappings;
  mappingsData.generated = new Date().toISOString();
  
  // Remove reconciled items from unmapped list
  const reconciledIds = new Set(results.filter(r => r.selectedFile).map(r => r.nodeId));
  mappingsData.unmapped = mappingsData.unmapped.filter((u: any) => !reconciledIds.has(u.nodeId));
  
  // Write updated mappings
  fs.writeFileSync(mappingsPath, JSON.stringify(mappingsData, null, 2));
  
  // Write reconciliation results to separate file
  const resultsPath = mappingsPath.replace('node-mappings.json', 'reconcile-results.json');
  const resultsData = {
    generated: new Date().toISOString(),
    aiModel: OPENAI_MODEL,
    confidenceThreshold: CONFIDENCE_THRESHOLD,
    results: results
  };
  fs.writeFileSync(resultsPath, JSON.stringify(resultsData, null, 2));
  
  // Summary
  const reconciled = results.filter(r => r.selectedFile !== null).length;
  console.log(`\nAI Reconciliation Summary:`);
  console.log(`  Total processed: ${results.length}`);
  console.log(`  Successfully matched: ${reconciled}`);
  console.log(`  Unable to match: ${results.length - reconciled}`);
  console.log(`  Updated mappings: ${mappingsPath}`);
  console.log(`  Results saved to: ${resultsPath}`);
}