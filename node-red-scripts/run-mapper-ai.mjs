import { generateMappingFile } from './build/deploy/mappings/mapper.ts';

console.log('Regenerating function mappings with AI reconciliation...\n');
await generateMappingFile({ useAI: true });
console.log('\nMapping generation complete!');
