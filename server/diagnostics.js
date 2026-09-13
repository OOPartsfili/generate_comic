import { mkdir, appendFile, stat, rename, rm, readFile } from 'node:fs/promises';
import path from 'node:path';

// Deliberately allow metadata only. Never accept raw RPC payloads, prompts, errors,
// stderr, account objects, image data or filesystem paths into diagnostic files.
const identifiers = new Set(['traceId', 'threadId', 'turnId']);
const numbers = new Set(['durationMs', 'imageCount', 'messageCount', 'resultBytes', 'referenceCount', 'exitCode']);
const labels = new Set(['stage', 'code', 'model', 'kind', 'status', 'itemType', 'version', 'plan']);
function metadata(fields) {
  const result = {};
  for (const [key, value] of Object.entries(fields)) {
    if (identifiers.has(key) && typeof value === 'string' && /^[a-zA-Z0-9-]{1,80}$/.test(value)) result[key] = value;
    if (numbers.has(key) && Number.isFinite(value) && value >= 0) result[key] = value;
    if (labels.has(key) && typeof value === 'string' && /^[a-zA-Z0-9_.-]{1,80}$/.test(value) && !/(?:sk-|eyJ|token|secret)/i.test(value)) result[key] = value;
    if (['savedPathPresent', 'proxyEnabled'].includes(key) && typeof value === 'boolean') result[key] = value;
  }
  return result;
}

export class Diagnostics {
  constructor(root, { maxBytes = 1024 * 1024 } = {}) {
    this.directory = path.join(root, 'logs'); this.file = path.join(this.directory, 'codex.jsonl');
    this.maxBytes = maxBytes; this.pending = Promise.resolve(); this.writeError = false;
  }
  record(fields) {
    const line = JSON.stringify({ time: new Date().toISOString(), ...metadata(fields) }) + '\n';
    this.pending = this.pending.then(async () => {
      await mkdir(this.directory, { recursive: true });
      const size = await stat(this.file).then(s => s.size).catch(error => { if (error.code === 'ENOENT') return 0; throw error; });
      if (size + Buffer.byteLength(line) > this.maxBytes) {
        await rm(this.file + '.1', { force: true });
        if (size) await rename(this.file, this.file + '.1');
      }
      await appendFile(this.file, line, 'utf8'); this.writeError = false;
    }).catch(() => { this.writeError = true; }); // Logging must never discard a generated image.
    return this.pending;
  }
  async snapshot() {
    await this.pending;
    const entries = [];
    for (const file of [this.file + '.1', this.file]) {
      const content = await readFile(file, 'utf8').catch(error => { if (error.code !== 'ENOENT') this.writeError = true; return ''; });
      for (const line of content.split('\n')) {
        try { const row = JSON.parse(line); entries.push({ time: /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(row.time) ? row.time : null, ...metadata(row) }); } catch { /* Ignore an incomplete last line. */ }
      }
    }
    return { format: 'moge-diagnostics-v1', appVersion: '2.1.1', exportedAt: new Date().toISOString(), writeError: this.writeError, entries };
  }
}

export function errorCode(error) {
  if (error.name === 'AbortError') return 'CANCELLED';
  if (error.diagnosticCode) return error.diagnosticCode;
  if (error.status === 429) return 'QUOTA_OR_RATE_LIMIT';
  if (error.status === 401) return 'AUTH_REQUIRED';
  if (/timeout|超时/i.test(error.message || '')) return 'TIMEOUT';
  return 'CODEX_REQUEST_FAILED';
}
