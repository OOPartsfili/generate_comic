// Opt-in integration check. This consumes the signed-in ChatGPT account's Codex limits.
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { startServer } from '../server/index.js';
import { newProject } from '../shared/story.js';

if (process.env.MOGE_RUN_LIVE_CODEX !== '1') {
  console.log('Set MOGE_RUN_LIVE_CODEX=1 to run the real ChatGPT/Codex test (uses subscription limits).');
  process.exit(0);
}
const base = path.resolve('tests/.tmp'); await mkdir(base, { recursive: true });
const dir = await mkdtemp(path.join(base, 'live-workflow-'));
const service = await startServer({ port: 0, dataDir: dir });
const request = async (url, method = 'GET', body) => {
  const response = await fetch(service.url + '/api' + url, { method, headers: { 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const result = await response.json(); assert.ok(response.ok, result.error); return result;
};
try {
  const status = await request('/settings/test', 'POST'); assert.equal(status.connected, true); assert.equal(status.authType, 'chatgpt');
  console.log(`PASS: official ChatGPT authentication (${status.plan || 'subscription'}), no API key required.`);
  let project = await request('/projects', 'POST', { ...newProject(), idea: '海边灯塔的老守夜人丢了钥匙，一只橘猫用爪子从石阶缝中找出钥匙，结尾老人为它留了一碟温水。讲一个温暖的四格独立片段。', panelCount: 4, wordCount: 400, quality: 'low' });
  async function generate(type, targetId) {
    const job = await request(`/projects/${project.id}/jobs`, 'POST', { type, targetId, revision: project.revision });
    const deadline = Date.now() + 960000;
    while (Date.now() < deadline) {
      const current = await request(`/jobs/${job.id}`);
      if (!['queued', 'running', 'cancelling'].includes(current.status)) {
        assert.equal(current.status, 'completed', current.message); project = await request(`/projects/${project.id}`);
        console.log(`PASS: ${type}${targetId ? ' with panel target' : ''}.`); return current;
      }
      await new Promise(resolve => setTimeout(resolve, 1500));
    }
    throw new Error('Live job timed out');
  }
  await generate('outline'); assert.ok(project.outline); assert.equal(project.outlineApproved, false);
  project = await request(`/projects/${project.id}`, 'PUT', { ...project, outlineApproved: true });
  await generate('prose'); await generate('storyboard'); assert.equal(project.panels.length, 4);
  await generate('panel', project.panels[0].id);
  const second = await generate('panel', project.panels[1].id);
  assert.equal(second.usage[0].references, 1, 'Second panel must use the previous real image as a continuity reference.');
  const exported = await request(`/projects/${project.id}/export`);
  assert.match(exported.project.panels[0].image, /^data:image\/png/);
  assert.match(exported.project.panels[1].image, /^data:image\/png/);
  assert.ok(!/(apiKey|access_token|refresh_token|encryptedKey)/.test(JSON.stringify(exported)));
  await writeFile(path.join(dir, 'verified-project.moge.json'), JSON.stringify(exported));
  console.log(JSON.stringify({ result: 'PASS', verified: 'outline + prose + 4-panel script + 2 real illustrations with continuity reference + export', directory: dir, images: project.panels.slice(0, 2).map(panel => service.store.assetFile(panel.image)) }));
} finally {
  for (const controller of service.jobs.controllers.values()) controller.abort();
  service.ai.close(); service.server.closeAllConnections(); await new Promise(resolve => service.server.close(resolve));
}
