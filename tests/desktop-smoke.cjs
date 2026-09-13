const { _electron: electron } = require('playwright');
const { mkdir, mkdtemp, readFile, writeFile } = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
(async () => {
  const root = path.resolve('tests/.tmp'); await mkdir(root, { recursive: true }); const dir = await mkdtemp(path.join(root, 'desktop-'));
  const env = { ...process.env, MOGE_USER_DATA: path.join(dir, 'profile'), MOGE_DATA_DIR: path.join(dir, 'workspace') }; delete env.ELECTRON_RUN_AS_NODE;
  const executablePath = process.argv[2];
  const app = await electron.launch({ ...(executablePath ? { executablePath, args: [] } : { args: ['.'] }), env, timeout: 45000 });
  try {
    const page = await app.firstWindow(); await page.waitForLoadState('domcontentloaded');
    await page.getByRole('button', { name: '开始一个新故事' }).waitFor();
    assert.equal(await page.evaluate(() => typeof window.require), 'undefined');
    await page.screenshot({ path: path.resolve('tests/desktop-home.png') });
    await page.getByRole('button', { name: /OpenAI 设置/ }).click();
    await page.getByLabel('OpenAI API 密钥').fill('test-only-not-a-real-openai-key');
    await page.getByRole('button', { name: '保存设置', exact: true }).click();
    await page.getByText('设置已保存，密钥使用 Windows 账户加密。').waitFor();
    const contents = await readFile(path.join(dir, 'workspace', 'settings.json'), 'utf8'); assert.ok(!contents.includes('test-only-not-a-real-openai-key')); assert.ok(JSON.parse(contents).encryptedKey);
    await page.getByRole('button', { name: '关闭弹窗' }).click();
    await page.getByRole('button', { name: '体验示例纲要' }).click();
    await page.getByLabel('作品标题').waitFor();
    await page.screenshot({ path: path.resolve('tests/desktop-outline.png') });
    await writeFile(path.join(dir, 'verified.txt'), 'Desktop launch, isolated renderer, encrypted settings and project persistence verified.');
    console.log('PASS: native desktop window, sandbox, Windows encrypted key, sample project.');
  } finally { await app.close(); }
  const reopened = await electron.launch({ ...(executablePath ? { executablePath, args: [] } : { args: ['.'] }), env, timeout: 45000 });
  try { const page = await reopened.firstWindow(); await page.getByRole('button', { name: /OpenAI 设置/ }).click(); await page.getByLabel('OpenAI API 密钥').waitFor(); assert.ok((await page.getByLabel('OpenAI API 密钥').getAttribute('placeholder')).includes('已保存')); console.log('PASS: encrypted key recovered after full restart.'); } finally { await reopened.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
