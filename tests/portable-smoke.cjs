const { chromium } = require('playwright');
const { spawn } = require('node:child_process');
const { createServer } = require('node:net');
const { mkdir, mkdtemp, readFile } = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
(async () => {
  const root = path.resolve('tests/.tmp'); await mkdir(root, { recursive: true }); const dir = await mkdtemp(path.join(root, 'portable-'));
  const env = { ...process.env, MOGE_USER_DATA: path.join(dir, 'profile'), MOGE_DATA_DIR: path.join(dir, 'workspace') }; delete env.ELECTRON_RUN_AS_NODE;
  for (let turn = 0; turn < 2; turn++) {
    const socket = createServer(); await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve)); const port = socket.address().port; await new Promise(resolve => socket.close(resolve));
    const child = spawn(path.resolve('墨格创作室.exe'), [`--remote-debugging-port=${port}`], { env, windowsHide: true, stdio: 'ignore' });
    let browser;
    try {
      let ready = false;
      for (let i = 0; i < 180; i++) { try { const r = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(1000) }); if (r.ok) { ready = true; break; } } catch { /* Wait for portable extraction and desktop startup. */ } await new Promise(resolve => setTimeout(resolve, 500)); }
      assert.ok(ready, 'Portable did not start its desktop window in time.');
      browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`); const page = browser.contexts()[0].pages()[0]; await page.getByRole('button', { name: /OpenAI 设置/ }).waitFor();
      assert.equal(await page.evaluate(() => typeof window.require), 'undefined');
      await page.getByRole('button', { name: /OpenAI 设置/ }).click();
      if (!turn) { await page.getByLabel('OpenAI API 密钥').fill('portable-test-only-not-a-real-key'); await page.getByRole('button', { name: '保存设置', exact: true }).click(); await page.getByText('设置已保存，密钥使用 Windows 账户加密。').waitFor(); }
      else assert.ok((await page.getByLabel('OpenAI API 密钥').getAttribute('placeholder')).includes('已保存'));
      await page.getByRole('button', { name: '关闭弹窗' }).click();
      await page.screenshot({ path: path.resolve('docs/screenshots/单文件程序主页.png') });
      const saved = await readFile(path.join(dir, 'workspace', 'settings.json'), 'utf8'); assert.ok(JSON.parse(saved).encryptedKey); assert.ok(!saved.includes('portable-test-only-not-a-real-key'));
      await page.evaluate(() => window.close()).catch(() => {});
      console.log(`PASS: portable EXE ${turn ? 'restart and key recovery' : 'extraction, real UI, sandbox and encrypted settings'}.`);
    } finally {
      if (browser) await browser.close().catch(() => {});
      if (child.exitCode === null) await Promise.race([new Promise(resolve => child.once('exit', resolve)), new Promise(resolve => setTimeout(resolve, 5000))]);
      if (child.exitCode === null) child.kill();
    }
  }
})().catch(e => { console.error(e); process.exitCode = 1; });
