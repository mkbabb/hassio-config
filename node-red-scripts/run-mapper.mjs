import { generateMappingFile } from './build/deploy/mappings/mapper.ts';

console.log('Regenerating function mappings...\n');
await generateMappingFile({ useAI: false });
console.log('\nMapping generation complete!');
