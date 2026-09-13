import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import JSZip from 'jszip';
test('十二格全部导出，多页 ZIP 与 PDF、长条预览', async ({ page }) => {
  await page.goto('/'); await page.getByRole('button', { name: '体验示例纲要' }).click();
  await page.getByRole('button', { name: '确认纲要，继续创作' }).click();
  await page.getByRole('navigation', { name: '创作步骤' }).getByRole('button', { name: /创作灵感/ }).click();
  await page.getByRole('button', { name: /十二格短篇/ }).click();
  await page.getByRole('navigation', { name: '创作步骤' }).getByRole('button', { name: /分镜绘制/ }).click();
  await page.getByRole('button', { name: '生成 12 格分镜脚本' }).click(); await expect(page.locator('.story-card')).toHaveCount(12);
  await page.getByRole('button', { name: '绘制缺失的 12 格' }).click(); await expect(page.getByText('12 / 12 格已绘制', { exact: true })).toBeVisible();
  await page.getByRole('navigation', { name: '创作步骤' }).getByRole('button', { name: /排版导出/ }).click(); await expect(page.locator('.page-previews canvas')).toHaveCount(3);
  const zipPromise = page.waitForEvent('download'); await page.getByRole('button', { name: '导出高清 PNG' }).click(); const zipDownload = await zipPromise;
  const zip = await JSZip.loadAsync(await readFile(await zipDownload.path())); expect(Object.keys(zip.files).filter(f => f.endsWith('.png'))).toHaveLength(3);
  const pdfPromise = page.waitForEvent('download'); await page.getByRole('button', { name: '导出漫画 PDF' }).click(); const pdfDownload = await pdfPromise;
  const pdf = (await readFile(await pdfDownload.path())).toString('latin1'); expect(pdf.match(/\/Type \/Page\b/g)).toHaveLength(3);
  await page.getByLabel('页面布局').selectOption('strip'); await expect(page.locator('.page-previews canvas')).toHaveCount(1);
  expect(await page.locator('.page-previews canvas').evaluate(c => c.height / c.width)).toBeGreaterThan(6);
});
