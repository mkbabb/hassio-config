const fs = require('fs');
const path = require('path');

const flowsPath = '/Volumes/addon_configs/a0d7b954_nodered/flows.json';
const flows = JSON.parse(fs.readFileSync(flowsPath, 'utf8'));

// Analyze function nodes
const functionNodes = [];
const nodeMapping = {};

flows.forEach(node => {
  if (node.type === 'function') {
    functionNodes.push({
      id: node.id,
      name: node.name,
      func: node.func ? node.func.substring(0, 200) + '...' : 'No function',
      z: node.z,
      outputs: node.outputs || 1,
      noerr: node.noerr || 0
    });
    
    // Try to extract potential file reference from the code
    if (node.func) {
      // Look for common patterns in comments or code
      const patterns = [
        /\/\/\s*(?:from|source|file):\s*(.+\.ts)/gi,
        /\/\*\s*(?:from|source|file):\s*(.+\.ts)\s*\*\//gi,
        /(?:presence|battery|time-of-use|plants|schedule)\.ts/gi
      ];
      
      patterns.forEach(pattern => {
        const matches = node.func.match(pattern);
        if (matches) {
          nodeMapping[node.id] = {
            nodeId: node.id,
            nodeName: node.name,
            possibleFile: matches[0],
            confidence: 'medium'
          };
        }
      });
    }
  }
});

console.log(`Total nodes: ${flows.length}`);
console.log(`Function nodes found: ${functionNodes.length}`);
console.log('\nFunction Nodes Summary:');
console.log(JSON.stringify(functionNodes, null, 2));
console.log('\nPotential Mappings:');
console.log(JSON.stringify(nodeMapping, null, 2));

// Save detailed analysis
fs.writeFileSync('/Volumes/config/flows_analysis.json', JSON.stringify({
  totalNodes: flows.length,
  functionNodes: functionNodes,
  potentialMappings: nodeMapping,
  timestamp: new Date().toISOString()
}, null, 2));