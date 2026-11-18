import { readFileSync, writeFileSync } from 'node:fs';
import { parseShopSenseModel } from '../src/types/model.schema.mjs';

// Authoring helper only. Runtime and backend CI use the checked-in backend snapshot.
const source = new URL('../../shopsense-frontend/public/shopsense-ai-model.json', import.meta.url);
const destination = new URL('../data/shopsense-ai-model.json', import.meta.url);
const content = readFileSync(source, 'utf8');
parseShopSenseModel(JSON.parse(content));
if (process.argv.includes('--check')) {
  if (readFileSync(destination, 'utf8') !== content) {
    process.stderr.write('The frontend and backend content contracts differ. Run the sync helper.\n');
    process.exitCode = 1;
  } else process.stdout.write('Content contracts match.\n');
} else {
  writeFileSync(destination, content);
  process.stdout.write('Updated the backend-owned content snapshot.\n');
}
