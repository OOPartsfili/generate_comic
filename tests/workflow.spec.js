import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
test('从灵感到成品：编辑、自动保存、生成、重绘、气泡、PNG/PDF 与工程恢复', async ({ page }, info) => {
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('/');
  await page.getByRole('button', { name: '开始一个新故事' }).click();
  await page.getByLabel('你想讲一个怎样的故事？').fill('一个女孩在末班车上遇见收集心愿星星的老人。给这个短篇一个温暖的反转。');
  await page.screenshot({ path: info.outputPath('01-idea.png'), fullPage: true });
  await page.getByRole('button', { name: '生成故事纲要', exact: true }).click();
  await expect(page.getByLabel('一句话故事')).toBeVisible();
  await page.getByLabel('结尾与余韵').fill('女孩按下车铃，带着星星的微光走向家。');
  // Confirm immediately, without waiting for autosave: verifies the approval/save race.
  await page.getByRole('button', { name: '确认纲要，继续创作' }).click();
  await expect(page.getByRole('button', { name: '根据纲要写文稿' })).toBeEnabled();
  await page.getByRole('button', { name: '根据纲要写文稿' }).click();
  await expect(page.getByLabel('小说文稿')).toHaveValue(/雨停了/);
  await page.getByRole('button', { name: '生成参考图', exact: true }).first().click();
  await expect(page.getByAltText('小满的角色参考图')).toBeVisible();
  await page.getByRole('button', { name: '前往分镜绘制' }).click();
  await page.getByRole('button', { name: '生成 4 格分镜脚本' }).click();
  await expect(page.locator('.story-card')).toHaveCount(4);
  await page.getByRole('button', { name: '绘制缺失的 4 格' }).click();
  await expect(page.getByText('4 / 4 格已绘制', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '重新绘制这一格' }).click();
  await expect(page.locator('.job-dock')).toBeHidden();
  await page.getByText('画面提示与版本', { exact: true }).click();
  await expect(page.getByRole('button', { name: '采用画面版本2' })).toBeVisible();
  await page.getByRole('button', { name: '采用画面版本1' }).click();
  await page.screenshot({ path: info.outputPath('02-storyboard.png'), fullPage: true });
  await page.getByRole('button', { name: /排版导出/ }).click();
  await expect(page.locator('.page-previews canvas')).toHaveCount(1);
  await page.getByLabel('对白文字').fill('今晚，终于有人为你留了一盏灯。');
  await page.getByLabel('气泡横向位置', { exact: false }).fill('25');
  for (const [name, extension] of [['导出高清 PNG', '.png'], ['导出漫画 PDF', '.pdf'], ['导出可编辑工程', '.moge.json']]) {
    const downloadPromise = page.waitForEvent('download'); await page.getByRole('button', { name }).click(); const download = await downloadPromise;
    expect(download.suggestedFilename()).toContain(extension); const bytes = await readFile(await download.path());
    expect(bytes.length).toBeGreaterThan(500);
    if (extension === '.pdf') expect(bytes.toString('ascii', 0, 4)).toBe('%PDF');
    if (extension === '.moge.json') { const data = JSON.parse(bytes.toString()); expect(data.project.panels).toHaveLength(4); expect(data.project.panels[0].dialogue).toContain('一盏灯'); }
  }
  await page.screenshot({ path: info.outputPath('03-export.png'), fullPage: true });
  await page.reload();
  await page.getByRole('navigation', { name: '创作步骤' }).getByRole('button', { name: /故事纲要/ }).click();
  await expect(page.getByLabel('结尾与余韵')).toHaveValue('女孩按下车铃，带着星星的微光走向家。');
  expect(errors).toEqual([]);
});

test('首屏与窄窗口布局、设置、示例和历史恢复', async ({ page }, info) => {
  await page.goto('/');
  await page.screenshot({ path: info.outputPath('04-home.png'), fullPage: true });
  await page.getByRole('button', { name: '体验示例纲要' }).click();
  await page.getByRole('button', { name: '保存版本', exact: true }).click();
  await expect(page.getByText('已保存一份可恢复的作品版本。')).toBeVisible();
  await page.getByLabel('作品标题').fill('临时的新标题');
  await page.getByRole('button', { name: '历史', exact: true }).click();
  await page.getByRole('button', { name: '恢复', exact: true }).first().click();
  await expect(page.getByLabel('作品标题')).toHaveValue('末班车上的星星');
  await page.getByRole('button', { name: /OpenAI 设置/ }).click();
  await expect(page.getByLabel('OpenAI API 密钥')).toHaveAttribute('type', 'password');
  await page.getByRole('button', { name: '保存并检测连接' }).click();
  await expect(page.getByText(/OpenAI 连接成功/)).toBeVisible();
  await page.getByRole('button', { name: '关闭弹窗' }).click();
  await page.getByRole('button', { name: /创作灵感/ }).click();
  await page.setViewportSize({ width: 960, height: 760 });
  await page.screenshot({ path: info.outputPath('05-narrow.png'), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
