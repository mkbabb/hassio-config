#!/usr/bin/env node
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { fileURLToPath } from 'url';
import { config as loadEnv } from 'dotenv';
import { createBackup } from './backup';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';

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
  
  constructor() {
    // Direct file path to flows.json
    const flowsPath = '/Volumes/addon_configs/a0d7b954_nodered/flows.json';
    
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
  
  async deploy(tsFiles: string[], options: { backup?: boolean; dryRun?: boolean; force?: boolean } = {}): Promise<DeployResult> {
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
        console.log(`✓ Backup created: ${backupResult.filename}`);
      }
      
      // Read flows directly from file
      console.log(`Reading flows from: ${this.config.flowsPath}`);
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
          console.log(`No mappings found for ${relativePath}`);
          continue;
        }
        
        // Skip low confidence mappings
        const validMappings = mappings.filter(m => 
          !m.confidence || m.confidence !== 'low'
        );
        
        if (validMappings.length === 0) {
          console.log(`Skipping ${relativePath} - only low confidence mappings`);
          continue;
        }
        
        // Read the compiled JS file
        // Build the dist path based on the relative path
        const jsRelativePath = relativePath.replace(/^src\//, '').replace(/\.ts$/, '.js');
        const jsFile = path.join(projectRoot, 'dist', jsRelativePath);
        
        if (!fs.existsSync(jsFile)) {
          result.failed.push(tsFile);
          console.error(`Compiled file not found: ${jsFile}`);
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
              console.log(`Would deploy ${relativePath} to ${mapping.nodeName} (${mapping.nodeId}) - ${reason}`);
            }
          } else {
            console.log(`Skipping ${relativePath} → ${mapping.nodeName} - no changes`);
          }
        }
      }
      
      if (toBeDeployed.length === 0) {
        console.log('No functions need deployment - all are up to date');
        return result;
      }
      
      // Deploy only changed functions
      console.log(`\nDeploying ${toBeDeployed.length} changed functions...`);
      
      if (!options.dryRun) {
        // Update nodes in the flows array
        for (const { tsFile, mapping, code } of toBeDeployed) {
          const nodeIndex = flows.findIndex((n: any) => n.id === mapping.nodeId);
          if (nodeIndex >= 0) {
            flows[nodeIndex].func = code;
            result.deployed.push(`${tsFile} → ${mapping.nodeName}`);
            console.log(`✓ Updated ${mapping.nodeName}`);
          } else {
            result.failed.push(`${tsFile} → ${mapping.nodeName}`);
            console.error(`✗ Node ${mapping.nodeId} not found in flows`);
          }
        }
        
        // Write updated flows back to file
        console.log('\nWriting updated flows...');
        fs.writeFileSync(this.config.flowsPath, JSON.stringify(flows, null, 2));
        console.log('✓ Flows updated successfully');
        
        // Attempt to restart Node-RED addon
        console.log('\nAttempting to restart Node-RED addon...');
        const restartSuccess = await this.restartNodeRed();
        
        if (restartSuccess) {
          console.log('✓ Node-RED addon restart initiated');
          console.log('⏳ Please wait a few seconds for Node-RED to restart');
        } else {
          console.log('\n⚠️  Could not restart Node-RED automatically');
          console.log('   Please restart manually:');
          console.log('   - Go to: Settings → Add-ons → Node-RED → Restart');
          console.log('   - Or use: ha addon restart a0d7b954_nodered');
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
    .example('$0 src/presence/presence.ts', 'Deploy a specific file')
    .example('$0 --all', 'Deploy all mapped functions')
    .example('$0 --dry-run src/**.ts', 'Preview deployment of multiple files')
    .help()
    .argv as any;

  async function main() {
    try {
      const deployer = new Deployer();
      
      // Determine which files to deploy
      let filesToDeploy: string[] = argv._ as string[];
      
      if (argv.all) {
        // Get all mapped files
        const mappings = deployer.getAllMappedFiles();
        filesToDeploy = mappings;
        console.log(`Deploying all ${mappings.length} mapped functions...`);
      } else if (filesToDeploy.length === 0) {
        console.error('Error: No files specified. Use --all to deploy all mapped functions.');
        process.exit(1);
      }
      
      // Deploy
      const result = await deployer.deploy(filesToDeploy, {
        backup: !argv['no-backup'],
        dryRun: argv['dry-run'],
        force: argv.force
      });
      
      // Report results
      if (result.success) {
        if (result.deployed.length > 0) {
          console.log(`\n✓ Deployment successful`);
          console.log(`  Deployed: ${result.deployed.length} functions`);
          result.deployed.forEach(d => console.log(`    - ${d}`));
        } else {
          console.log('\n✓ No functions needed deployment');
        }
        
        if (result.failed.length > 0) {
          console.log(`\n⚠️  Failed: ${result.failed.length} functions`);
          result.failed.forEach(f => console.log(`    - ${f}`));
        }
      } else {
        console.error(`\n✗ Deployment failed: ${result.error}`);
        process.exit(1);
      }
    } catch (error) {
      console.error('Fatal error:', error);
      process.exit(1);
    }
  }

  main();
}