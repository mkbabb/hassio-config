import * as fs from 'fs';
import * as path from 'path';
import { createBackup } from './backup';

interface DeployConfig {
  nodeRedUrl: string;
  authToken?: string;
  mappings: Record<string, Array<{
    nodeId: string;
    nodeName: string;
  }>>;
}

interface DeployResult {
  success: boolean;
  deployed: string[];
  failed: string[];
  error?: string;
}

export class Deployer {
  private config: DeployConfig;
  
  constructor() {
    const mappingsPath = path.join(__dirname, '../../node-mappings.json');
    const mappingsData = JSON.parse(fs.readFileSync(mappingsPath, 'utf8'));
    
    this.config = {
      nodeRedUrl: process.env.NODE_RED_URL || 'http://homeassistant.local:8123/a0d7b954_nodered/ingress',
      authToken: process.env.HA_TOKEN,
      mappings: mappingsData.mappings || {}
    };
  }
  
  async deploy(tsFiles: string[], options: { backup?: boolean; dryRun?: boolean } = {}): Promise<DeployResult> {
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
      }
      
      // Get current flows
      const flows = await this.getFlows();
      if (!flows) {
        throw new Error('Failed to fetch flows');
      }
      
      // Deploy each file
      for (const tsFile of tsFiles) {
        const relativePath = path.relative(path.join(__dirname, '../..'), tsFile);
        const mappings = this.config.mappings[relativePath];
        
        if (!mappings || mappings.length === 0) {
          console.log(`No mappings found for ${relativePath}`);
          continue;
        }
        
        // Read the compiled JS file
        const jsFile = tsFile.replace(/\/src\//, '/dist/').replace(/\.ts$/, '.js');
        if (!fs.existsSync(jsFile)) {
          result.failed.push(tsFile);
          console.error(`Compiled file not found: ${jsFile}`);
          continue;
        }
        
        const code = fs.readFileSync(jsFile, 'utf8');
        
        // Update each mapped node
        for (const mapping of mappings) {
          if (options.dryRun) {
            console.log(`Would deploy ${relativePath} to ${mapping.nodeName} (${mapping.nodeId})`);
            result.deployed.push(`${relativePath} → ${mapping.nodeName}`);
          } else {
            const updated = this.updateNodeInFlows(flows, mapping.nodeId, code);
            if (updated) {
              result.deployed.push(`${relativePath} → ${mapping.nodeName}`);
            } else {
              result.failed.push(`${relativePath} → ${mapping.nodeName}`);
            }
          }
        }
      }
      
      // Deploy updated flows
      if (!options.dryRun && result.deployed.length > 0) {
        const deployed = await this.deployFlows(flows);
        if (!deployed) {
          throw new Error('Failed to deploy flows');
        }
      }
      
    } catch (error) {
      result.success = false;
      result.error = error instanceof Error ? error.message : 'Unknown error';
    }
    
    return result;
  }
  
  private async getFlows(): Promise<any> {
    const { default: fetch } = await import('node-fetch');
    const headers: any = {
      'Content-Type': 'application/json'
    };
    
    if (this.config.authToken) {
      headers['Authorization'] = `Bearer ${this.config.authToken}`;
      headers['X-HA-Access'] = this.config.authToken;
    }
    
    const response = await fetch(`${this.config.nodeRedUrl}/flows`, {
      method: 'GET',
      headers
    });
    
    if (!response.ok) {
      console.error(`Failed to get flows: ${response.status} ${response.statusText}`);
      return null;
    }
    
    return response.json();
  }
  
  private updateNodeInFlows(flows: any, nodeId: string, code: string): boolean {
    const flowsArray = flows.flows || flows;
    
    for (let i = 0; i < flowsArray.length; i++) {
      if (flowsArray[i].id === nodeId && flowsArray[i].type === 'function') {
        flowsArray[i].func = code;
        return true;
      }
    }
    
    return false;
  }
  
  private async deployFlows(flows: any): Promise<boolean> {
    const { default: fetch } = await import('node-fetch');
    const headers: any = {
      'Content-Type': 'application/json',
      'Node-RED-Deployment-Type': 'nodes'
    };
    
    if (this.config.authToken) {
      headers['Authorization'] = `Bearer ${this.config.authToken}`;
      headers['X-HA-Access'] = this.config.authToken;
    }
    
    const response = await fetch(`${this.config.nodeRedUrl}/flows`, {
      method: 'POST',
      headers,
      body: JSON.stringify(flows)
    });
    
    if (!response.ok) {
      console.error(`Failed to deploy flows: ${response.status} ${response.statusText}`);
      return false;
    }
    
    return true;
  }
}