import path from 'node:path';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { startServer } from '../server/index.js';
import { fakeAI } from './fixtures.js';
const root = path.resolve('tests/.tmp'); await mkdir(root, { recursive: true });
const dataDir = await mkdtemp(path.join(root, 'ui-'));
const service = await startServer({ port: 8799, dataDir, aiFactory: fakeAI });
await service.settings.save({ provider: 'codex', textModel: 'gpt-5-mini', imageModel: 'gpt-image-2' });
console.log('Isolated UI fixture ready on 8799. No external API requests.');
