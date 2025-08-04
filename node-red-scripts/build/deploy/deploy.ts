#!/usr/bin/env node
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { fileURLToPath } from 'url';
import { config as loadEnv } from 'dotenv';
import { createBackup, selectAndRestoreBackup, restoreBackup, getBackupInfo } from './backup';
import { renameFunctionNodes } from './rename';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { StyleHelper } from '../style';

// Load environment variables
loadEnv();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface NodeMapping {
  nodeId: string;
  nodeName: string;
  flowId?: string;
  flowName?: string;
  confidence?: string;
}

interface DeployConfig {
  flowsPath: string;
  mappings: Record<string, NodeMapping[]>;
}

interface DeployResult {
  success: boolean;
  deployed: string[];
  failed: string[];
  error?: string;
}

export class Deployer {
  private config: DeployConfig;
  private nodeHashes: Map<string, string> = new Map();
  private nodeRedUrl: string;
  private haToken: string | undefined;
  private haUsername: string | undefined;
  private haPassword: string | undefined;
  
  constructor() {
    // Direct file path to flows.json
    const flowsPath = process.env.NODE_RED_FLOWS_PATH || '/Volumes/addon_configs/a0d7b954_nodered/flows.json';
    
    // Node-RED URL and auth
    // Try direct Node-RED port first, then ingress
    this.nodeRedUrl = process.env.NODE_RED_URL || 'http://localhost:1880';
    this.haToken = process.env.HA_TOKEN;
    this.haUsername = process.env.HA_USERNAME;
    this.haPassword = process.env.HA_PASSWORD;
    
    // Load mappings
    const mappingsDir = path.join(__dirname, 'mappings');
    const enhancedPath = path.join(mappingsDir, 'node-mappings-enhanced.json');
    const standardPath = path.join(mappingsDir, 'node-mappings.json');
    
    const mappingsPath = fs.existsSync(enhancedPath) ? enhancedPath : standardPath;
    
    if (!fs.existsSync(mappingsPath)) {
      throw new Error(`No mappings file found. Run 'npm run map' first.`);
    }
    
    const mappingsData = JSON.parse(fs.readFileSync(mappingsPath, 'utf8'));
    
    this.config = {
      flowsPath,
      mappings: mappingsData.mappings || {}
    };
    
    if (!fs.existsSync(flowsPath)) {
      throw new Error(`flows.json not found at ${flowsPath}`);
    }
  }
  
  private getCodeHash(code: string): string {
    return crypto.createHash('md5').update(code).digest('hex');
  }
  
  getAllMappedFiles(): string[] {
    return Object.keys(this.config.mappings);
  }
  
  /**
   * Deploy using Node-RED Admin API with "nodes" deployment type
   * This only restarts modified nodes, not the entire addon
   */
  private async deployViaAPI(flows: any[], updatedNodeIds: string[]): Promise<boolean> {
    const { default: fetch } = await import('node-fetch');
    
    // Try multiple Node-RED endpoints
    const urls = [
      process.env.NODE_RED_URL,
      'http://homeassistant.local:1880',
      'http://localhost:1880',
      'http://127.0.0.1:1880',
      'http://addon_a0d7b954_nodered:1880',
      'http://a0d7b954_nodered:1880'
    ].filter(Boolean);
    
    console.log(StyleHelper.info("Deploying via Node-RED Admin API"));
    console.log(StyleHelper.info(`Updating ${updatedNodeIds.length} nodes with hot reload`));
    
    for (const baseUrl of urls) {
      try {
        const url = `${baseUrl}/flows`;
        console.log(`  Trying: ${url}`);
        
        // Build headers with proper authentication
        const headers: any = {
          'Content-Type': 'application/json',
          'Node-RED-Deployment-Type': 'nodes',
          'Node-RED-API-Version': 'v2'
        };
        
        // Add authentication - prefer Basic auth for Node-RED
        if (this.haUsername && this.haPassword) {
          const auth = Buffer.from(`${this.haUsername}:${this.haPassword}`).toString('base64');
          headers['Authorization'] = `Basic ${auth}`;
        } else if (this.haToken) {
          headers['Authorization'] = `Bearer ${this.haToken}`;
        }
        
        const response = await fetch(url, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            flows: flows
          }),
          timeout: 5000
        });
        
        if (response.ok) {
          const result = await response.text();
          console.log(StyleHelper.success("Node-RED API deployment successful"));
          if (result) {
            console.log(StyleHelper.colors.muted(`Response: ${result}`));
          }
          return true;
        } else {
          const text = await response.text();
          console.log(StyleHelper.error(`Failed: ${response.status} ${response.statusText}`));
          if (text && text.length < 200) {
            console.log(StyleHelper.colors.muted(`Response: ${text}`));
          }
        }
      } catch (error: any) {
        console.log(StyleHelper.error("Connection error", error.message));
      }
    }
    
    return false;
  }
  
  /**
   * Deploy using file-based method with addon restart
   */
  private async deployViaFile(flows: any[]): Promise<boolean> {
    try {
      console.log(StyleHelper.info("Using file-based deployment"));
      
      // Write updated flows back to file
      console.log(StyleHelper.info("Writing updated flows to file"));
      fs.writeFileSync(this.config.flowsPath, JSON.stringify(flows, null, 2));
      console.log(StyleHelper.success("Flows updated successfully"));
      
      // Attempt to restart Node-RED addon
      console.log(StyleHelper.section("Addon Restart"));
      console.log(StyleHelper.info("Attempting to restart Node-RED addon"));
      const restartSuccess = await this.restartNodeRed();
      
      if (restartSuccess) {
        console.log(StyleHelper.success("Node-RED addon restart initiated"));
        console.log(StyleHelper.info("Please wait a few seconds for Node-RED to restart"));
      } else {
        console.log(StyleHelper.warning("Could not restart Node-RED automatically"));
        console.log(StyleHelper.colors.muted("Please restart manually:"));
        console.log(StyleHelper.colors.muted("  - Go to: Settings → Add-ons → Node-RED → Restart"));
        console.log(StyleHelper.colors.muted("  - Or use: ha addon restart a0d7b954_nodered"));
      }
      
      return true;
    } catch (error) {
      console.log(StyleHelper.error("File deployment error", (error as any).message));
      return false;
    }
  }
  
  async deploy(tsFiles: string[], options: { backup?: boolean; dryRun?: boolean; force?: boolean; useApi?: boolean } = {}): Promise<DeployResult> {
    const result: DeployResult = {
      success: true,
      deployed: [],
      failed: []
    };
    
    try {
      // Create backup if requested
      if (options.backup && !options.dryRun) {
        const backupResult = await createBackup();
        if (!backupResult.success) {
          throw new Error(`Backup failed: ${backupResult.error}`);
        }
        console.log(`${StyleHelper.colors.success(StyleHelper.symbols.success)} Backup created: ${StyleHelper.colors.bold(backupResult.filename)}`);
      }
      
      // Read flows directly from file
      console.log(StyleHelper.colors.muted(`${StyleHelper.symbols.info} Reading flows from: ${StyleHelper.colors.italic(this.config.flowsPath)}`));
      const flowsContent = fs.readFileSync(this.config.flowsPath, 'utf8');
      const flows = JSON.parse(flowsContent);
      
      // Build current node hash map for change detection
      for (const node of flows) {
        if (node.type === 'function' && node.func) {
          this.nodeHashes.set(node.id, this.getCodeHash(node.func));
        }
      }
      
      // Track what actually needs deployment
      const toBeDeployed: Array<{ tsFile: string; mapping: NodeMapping; code: string }> = [];
      
      // Check each file for changes
      for (const tsFile of tsFiles) {
        // Normalize the path - accept both absolute and relative paths
        const projectRoot = path.join(__dirname, '../..');
        let relativePath: string;
        
        if (path.isAbsolute(tsFile)) {
          relativePath = path.relative(projectRoot, tsFile);
        } else {
          // Already relative - just normalize
          relativePath = tsFile;
        }
        
        // Normalize path to use forward slashes
        relativePath = relativePath.replace(/\\/g, '/');
        
        const mappings = this.config.mappings[relativePath];
        
        if (!mappings || mappings.length === 0) {
          console.log(StyleHelper.colors.muted(`${StyleHelper.symbols.warning} No mappings found for ${StyleHelper.colors.italic(relativePath)}`));
          continue;
        }
        
        // Skip low confidence mappings
        const validMappings = mappings.filter(m => 
          !m.confidence || m.confidence !== 'low'
        );
        
        if (validMappings.length === 0) {
          console.log(StyleHelper.colors.muted(`${StyleHelper.symbols.info} Skipping ${StyleHelper.colors.italic(relativePath)} - only low confidence mappings`));
          continue;
        }
        
        // Read the compiled JS file
        // Build the dist path based on the relative path
        const jsRelativePath = relativePath.replace(/^src\//, '').replace(/\.ts$/, '.js');
        const jsFile = path.join(projectRoot, 'dist', jsRelativePath);
        
        if (!fs.existsSync(jsFile)) {
          result.failed.push(tsFile);
          console.error(StyleHelper.colors.error(`${StyleHelper.symbols.error} Compiled file not found: ${StyleHelper.colors.bold(jsFile)}`));
          continue;
        }
        
        const code = fs.readFileSync(jsFile, 'utf8');
        const newHash = this.getCodeHash(code);
        
        // Check each mapped node for changes
        for (const mapping of validMappings) {
          const currentHash = this.nodeHashes.get(mapping.nodeId);
          
          if (currentHash !== newHash || options.force) {
            toBeDeployed.push({ tsFile: relativePath, mapping, code });
            if (options.dryRun) {
              const reason = options.force ? 'forced' : 'code changed';
              const reasonColor = options.force ? StyleHelper.colors.warning : StyleHelper.colors.info;
              console.log(`${StyleHelper.colors.primary(StyleHelper.symbols.progress)} Would deploy ${StyleHelper.colors.bold(relativePath)} → ${StyleHelper.colors.bold(mapping.nodeName)} ${StyleHelper.colors.muted(`(${mapping.nodeId})`)} - ${reasonColor(reason)}`);
            }
          } else {
            console.log(StyleHelper.colors.muted(`${StyleHelper.symbols.info} Skipping ${StyleHelper.colors.italic(relativePath)} → ${StyleHelper.colors.italic(mapping.nodeName)} - no changes`));
          }
        }
      }
      
      if (toBeDeployed.length === 0) {
        console.log('No functions need deployment - all are up to date');
        return result;
      }
      
      // Deploy only changed functions
      console.log(StyleHelper.section("Function Deployment"));
      console.log(StyleHelper.info(`Deploying ${toBeDeployed.length} changed functions`));
      
      if (!options.dryRun) {
        // Update nodes in the flows array
        const updatedNodeIds: string[] = [];
        for (const { tsFile, mapping, code } of toBeDeployed) {
          const nodeIndex = flows.findIndex((n: any) => n.id === mapping.nodeId);
          if (nodeIndex >= 0) {
            flows[nodeIndex].func = code;
            updatedNodeIds.push(mapping.nodeId);
            result.deployed.push(`${tsFile} → ${mapping.nodeName}`);
            console.log(`${StyleHelper.colors.success(StyleHelper.symbols.success)} Prepared update for ${StyleHelper.colors.bold(mapping.nodeName)}`);
          } else {
            result.failed.push(`${tsFile} → ${mapping.nodeName}`);
            console.error(`${StyleHelper.colors.error(StyleHelper.symbols.error)} Node ${StyleHelper.colors.bold(mapping.nodeName)} ${StyleHelper.colors.muted(`(${mapping.nodeId})`)} not found in flows`);
          }
        }
        
        // Try API deployment first, fallback to file-based
        let deploySuccess = false;
        
        // Default to API method unless explicitly disabled
        const useApi = options.useApi !== false;
        
        if (useApi) {
          console.log(StyleHelper.section("API Deployment"));
          deploySuccess = await this.deployViaAPI(flows, updatedNodeIds);
          
          if (!deploySuccess) {
            console.log(StyleHelper.warning("API deployment failed, falling back to file-based method"));
          }
        }
        
        // Fallback to file-based deployment
        if (!deploySuccess) {
          console.log(StyleHelper.section("File Deployment"));
          deploySuccess = await this.deployViaFile(flows);
        }
        
        if (!deploySuccess) {
          throw new Error('All deployment methods failed');
        }
      } else {
        for (const { tsFile, mapping } of toBeDeployed) {
          result.deployed.push(`${tsFile} → ${mapping.nodeName}`);
        }
      }
      
    } catch (error) {
      result.success = false;
      result.error = error instanceof Error ? error.message : 'Unknown error';
    }
    
    return result;
  }
  
  private async restartNodeRed(): Promise<boolean> {
    try {
      const { exec } = await import('child_process');
      const { promisify } = await import('util');
      const execAsync = promisify(exec);
      
      // Try using Home Assistant CLI if available
      try {
        console.log('  Trying HA CLI...');
        await execAsync('ha addon restart a0d7b954_nodered');
        console.log('  ✓ HA CLI restart command succeeded');
        return true;
      } catch (haError) {
        console.log('  ✗ HA CLI not available:', (haError as any).message);
        // If HA CLI fails, try using the REST API
        const haToken = process.env.HA_TOKEN;
        if (!haToken) {
          console.log('No HA_TOKEN found for API restart');
          return false;
        }
        
        const { default: fetch } = await import('node-fetch');
        
        // Try the supervisor API
        console.log('  Trying Supervisor API...');
        try {
          const response = await fetch('http://supervisor/addons/a0d7b954_nodered/restart', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${haToken}`,
              'Content-Type': 'application/json'
            }
          });
          
          if (response.ok) {
            console.log('  ✓ Supervisor API restart succeeded');
            return true;
          } else {
            console.log(`  ✗ Supervisor API failed: ${response.status} ${response.statusText}`);
          }
        } catch (supervisorError) {
          console.log('  ✗ Supervisor API error:', (supervisorError as any).message);
        }
        
        // Try via Home Assistant API
        console.log('  Trying Home Assistant API...');
        try {
          const haResponse = await fetch('http://homeassistant.local:8123/api/services/hassio/addon_restart', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${haToken}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              addon: 'a0d7b954_nodered'
            })
          });
          
          if (haResponse.ok) {
            console.log('  ✓ Home Assistant API restart succeeded');
            return true;
          } else {
            const text = await haResponse.text();
            console.log(`  ✗ Home Assistant API failed: ${haResponse.status} ${haResponse.statusText}`);
            console.log(`    Response: ${text}`);
            return false;
          }
        } catch (haError) {
          console.log('  ✗ Home Assistant API error:', (haError as any).message);
          return false;
        }
      }
    } catch (error) {
      console.error('Restart error:', error instanceof Error ? error.message : error);
      return false;
    }
  }
}

// CLI functionality when run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const argv = yargs(hideBin(process.argv))
    .usage('Usage: $0 [options] [files...]')
    .option('all', {
      alias: 'a',
      type: 'boolean',
      describe: 'Deploy all mapped functions'
    })
    .option('force', {
      alias: 'f',
      type: 'boolean',
      describe: 'Force deployment even if no changes detected'
    })
    .option('dry-run', {
      alias: 'd',
      type: 'boolean',
      describe: 'Preview what would be deployed'
    })
    .option('no-backup', {
      type: 'boolean',
      describe: 'Skip backup creation'
    })
    .option('no-api', {
      type: 'boolean',
      describe: 'Use file-based deployment instead of Node-RED API'
    })
    .option('rename', {
      alias: 'r',
      type: 'boolean',
      describe: 'Rename function nodes to match their file names'
    })
    .option('rename-only', {
      type: 'boolean',
      describe: 'Only rename nodes without deploying code'
    })
    .option('list-backups', {
      type: 'boolean',
      describe: 'List available backup files'
    })
    .option('restore-backup', {
      type: 'string',
      describe: 'Restore from a specific backup file'
    })
    .option('restore-interactive', {
      type: 'boolean',
      describe: 'Interactively select and restore from available backups'
    })
    .example('$0 src/presence/presence.ts', 'Deploy a specific file')
    .example('$0 --all', 'Deploy all mapped functions')
    .example('$0 --all --rename', 'Deploy and rename all functions')
    .example('$0 --rename-only', 'Only rename nodes without deploying')
    .example('$0 --dry-run src/**.ts', 'Preview deployment of multiple files')
    .example('$0 --no-api', 'Use file-based deployment with restart')
    .example('$0 --list-backups', 'List all available backup files')
    .example('$0 --restore-backup flows_2025-08-02T19-10-25-224Z.json', 'Restore from specific backup')
    .example('$0 --restore-interactive', 'Interactively select and restore backup')
    .help()
    .argv as any;

  async function main() {
    try {
      // Handle backup-related operations first (they don't need a Deployer instance)
      if (argv['list-backups']) {
        const backups = getBackupInfo();
        if (backups.length === 0) {
          console.log(StyleHelper.warning('No backups found'));
          process.exit(0);
        }
        
        console.log(StyleHelper.section('Available Backups'));
        console.log(StyleHelper.info(`Found ${StyleHelper.colors.bold(backups.length.toString())} backup file(s)`));
        console.log(''); // Add spacing
        
        // Group recent backups (last 7) and older ones
        const recentBackups = backups.slice(0, 7);
        const olderBackups = backups.slice(7);
        
        if (recentBackups.length > 0) {
          console.log(StyleHelper.colors.bold('Recent Backups'));
          
          recentBackups.forEach((backup, index) => {
            const sizeKB = Math.round(backup.size / 1024);
            const ageColor = backup.relativeTime.includes('hour') ? StyleHelper.colors.success : 
                           backup.relativeTime.includes('day') ? StyleHelper.colors.warning : StyleHelper.colors.muted;
            
            const backupContent = [
              StyleHelper.keyValue('Date', StyleHelper.colors.bold(backup.humanDate)),
              StyleHelper.keyValue('Age', backup.relativeTime, StyleHelper.colors.muted, ageColor),
              StyleHelper.keyValue('Size', `${StyleHelper.colors.italic(sizeKB.toString())}KB`)
            ];
            
            console.log(StyleHelper.panel(backupContent, `${StyleHelper.colors.bold(`${index + 1}.`)} ${backup.filename}`));
          });
        }
        
        if (olderBackups.length > 0) {
          console.log('\n' + StyleHelper.colors.bold('Older Backups'));
          
          const olderContent = olderBackups.map((backup, index) => {
            const sizeKB = Math.round(backup.size / 1024);
            return `${StyleHelper.colors.muted(`${recentBackups.length + index + 1}.`)} ${StyleHelper.colors.bold(backup.filename)} ${StyleHelper.colors.muted(`(${backup.relativeTime}, ${sizeKB}KB)`)}`;
          });
          
          console.log(StyleHelper.panel(olderContent, 'Archive'));
        }
        
        process.exit(0);
      }
      
      if (argv['restore-backup']) {
        const filename = argv['restore-backup'] as string;
        console.log(StyleHelper.section('Backup Restoration'));
        
        const restoreContent = [
          StyleHelper.keyValue('Action', 'Restore backup'),
          StyleHelper.keyValue('File', StyleHelper.colors.bold(filename))
        ];
        console.log(StyleHelper.panel(restoreContent, 'Restoration Details'));
        
        const result = await restoreBackup(filename);
        
        if (result.success) {
          const successContent = [
            `${StyleHelper.colors.success(StyleHelper.symbols.success)} Backup restored successfully`,
            StyleHelper.keyValue('From', filename),
            '',
            StyleHelper.colors.muted('Note: You may need to restart Node-RED for changes to take effect')
          ];
          console.log(StyleHelper.panel(successContent, 'Restoration Complete'));
        } else {
          console.log(StyleHelper.error(`Restore failed: ${result.error}`));
          process.exit(1);
        }
        
        process.exit(0);
      }
      
      if (argv['restore-interactive']) {
        console.log(StyleHelper.section('Interactive Backup Restoration'));
        const result = await selectAndRestoreBackup();
        
        if (result.success) {
          console.log(StyleHelper.success('Backup restored successfully'));
          console.log(StyleHelper.colors.muted('Note: You may need to restart the Node-RED addon for changes to take effect.'));
        } else {
          console.log(StyleHelper.error(`Restore failed: ${result.error}`));
          process.exit(1);
        }
        
        process.exit(0);
      }
      
      const deployer = new Deployer();
      
      // Handle rename-only mode
      if (argv['rename-only']) {
        console.log(StyleHelper.section('Function Node Renaming'));
        console.log(StyleHelper.info('Renaming function nodes to match file names'));
        
        const auth = process.env.HA_USERNAME && process.env.HA_PASSWORD
          ? { username: process.env.HA_USERNAME, password: process.env.HA_PASSWORD }
          : undefined;
        
        const renameResult = await renameFunctionNodes({
          dryRun: argv['dry-run'],
          auth
        });
        
        if (!renameResult.success) {
          console.log(StyleHelper.error(`Rename failed: ${renameResult.error}`));
          process.exit(1);
        }
        
        if (renameResult.renamed.length === 0) {
          console.log(StyleHelper.info('No nodes need renaming', 'All nodes already match their file names'));
        } else {
          const verb = argv['dry-run'] ? 'Would rename' : 'Renamed';
          console.log(StyleHelper.success(`${verb} ${renameResult.renamed.length} function node(s):`));
          renameResult.renamed.forEach(r => 
            console.log(StyleHelper.colors.muted(`  ${r.oldName} ${StyleHelper.symbols.arrow} ${r.newName}`))
          );
        }
        
        if (renameResult.failed.length > 0) {
          console.log(StyleHelper.warning(`Failed to rename ${renameResult.failed.length} node(s):`));
          renameResult.failed.forEach(f => 
            console.log(StyleHelper.colors.error(`  ${f.nodeId}: ${f.error}`))
          );
        }
        
        console.log(StyleHelper.summary({
          total: renameResult.renamed.length + renameResult.failed.length,
          built: renameResult.renamed.length,
          failed: renameResult.failed.length > 0 ? renameResult.failed.length : undefined
        }));
        
        process.exit(0);
      }
      
      // Determine which files to deploy
      let filesToDeploy: string[] = argv._ as string[];
      
      if (argv.all) {
        // Get all mapped files
        const mappings = deployer.getAllMappedFiles();
        filesToDeploy = mappings;
        console.log(StyleHelper.info(`Deploying all ${mappings.length} mapped functions`));
      } else if (filesToDeploy.length === 0) {
        console.log(StyleHelper.error("No files specified", "Use --all to deploy all mapped functions"));
        process.exit(1);
      }
      
      // Deploy
      const result = await deployer.deploy(filesToDeploy, {
        backup: !argv['no-backup'],
        dryRun: argv['dry-run'],
        force: argv.force,
        useApi: !argv['no-api']
      });
      
      // Report results
      if (result.success) {
        if (result.deployed.length > 0) {
          const deployedContent = result.deployed.map(deployment => {
            const [file, nodeName] = deployment.split(' → ');
            return `${StyleHelper.colors.success(StyleHelper.symbols.success)} ${StyleHelper.colors.bold(file)} → ${StyleHelper.colors.bold(nodeName)}`;
          });
          
          console.log(StyleHelper.panel(deployedContent, `${StyleHelper.colors.success('Deployed')} ${StyleHelper.colors.bold(result.deployed.length.toString())} Functions`));
        } else {
          console.log(StyleHelper.info("No functions needed deployment", "All functions are up to date"));
        }
        
        if (result.failed.length > 0) {
          const failedContent = result.failed.map(f => 
            `${StyleHelper.colors.error(StyleHelper.symbols.error)} ${StyleHelper.colors.bold(f)}`
          );
          
          console.log(StyleHelper.panel(failedContent, `${StyleHelper.colors.error('Failed')} ${StyleHelper.colors.bold(result.failed.length.toString())} Functions`));
        }
        
        // Handle rename option after successful deployment
        if (argv.rename && result.deployed.length > 0 && !argv['dry-run']) {
          console.log(StyleHelper.section("Node Renaming"));
          console.log(StyleHelper.info("Renaming deployed function nodes"));
          const auth = process.env.HA_USERNAME && process.env.HA_PASSWORD
            ? { username: process.env.HA_USERNAME, password: process.env.HA_PASSWORD }
            : undefined;
          
          const renameResult = await renameFunctionNodes({
            dryRun: false,
            auth
          });
          
          if (renameResult.success && renameResult.renamed.length > 0) {
            console.log(StyleHelper.success(`Renamed ${renameResult.renamed.length} function node(s):`));
            renameResult.renamed.forEach(r => console.log(StyleHelper.colors.muted(`  ${r.oldName} → ${r.newName}`)));
          }
        }
      } else {
        console.log(StyleHelper.error("Deployment failed", result.error || "Unknown error"));
        process.exit(1);
      }
    } catch (error) {
      console.log(StyleHelper.error("Fatal deployment error", error instanceof Error ? error.message : String(error)));
      process.exit(1);
    }
  }

  main();
}