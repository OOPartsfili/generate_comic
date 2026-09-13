const { app, BrowserWindow, safeStorage, session, shell, dialog, net } = require('electron');
const path = require('node:path');
const { randomBytes } = require('node:crypto');

app.setName('墨格创作室');
app.setPath('userData', process.env.MOGE_USER_DATA || path.join(app.getPath('appData'), 'MogeStudio'));
let window, service;
const locked = app.requestSingleInstanceLock();
if (!locked) app.quit();
else {
  app.on('second-instance', () => { if (window) { if (window.isMinimized()) window.restore(); window.show(); window.focus(); } });
  app.whenReady().then(async () => {
    const { startServer } = await import('../server/index.js');
    const token = randomBytes(32).toString('hex');
    service = await startServer({ port: 0, token, dataDir: process.env.MOGE_DATA_DIR || path.join(app.getPath('userData'), 'workspace'), vault: safeStorage.isEncryptionAvailable() ? { encrypt: s => safeStorage.encryptString(s).toString('base64'), decrypt: s => safeStorage.decryptString(Buffer.from(s, 'base64')) } : undefined, fetchImpl: (url, init) => net.fetch(url, init) });
    session.defaultSession.webRequest.onBeforeSendHeaders({ urls: [`${service.url}/*`] }, (details, callback) => callback({ requestHeaders: { ...details.requestHeaders, 'x-studio-token': token } }));
    session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
    session.defaultSession.on('will-download', (_event, item) => { item.setSaveDialogOptions({ title: '导出作品', defaultPath: path.join(app.getPath('downloads'), item.getFilename()) }); });
    window = new BrowserWindow({ title: '墨格创作室 · 小说与漫画', width: 1440, height: 960, minWidth: 900, minHeight: 680, show: false, backgroundColor: '#f6f4f0', autoHideMenuBar: true, icon: path.join(__dirname, 'icon.png'), webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, spellcheck: false } });
    window.removeMenu();
    window.webContents.setWindowOpenHandler(({ url }) => { try { const target = new URL(url); if (target.protocol === 'https:' && ['platform.openai.com', 'developers.openai.com'].includes(target.hostname)) void shell.openExternal(url); } catch { /* Unsupported URLs stay blocked. */ } return { action: 'deny' }; });
    window.webContents.on('will-navigate', (event, url) => { if (!url.startsWith(`${service.url}/`)) event.preventDefault(); });
    window.webContents.on('will-prevent-unload', event => { const answer = dialog.showMessageBoxSync(window, { type: 'question', buttons: ['继续编辑', '放弃未保存编辑并退出'], defaultId: 0, cancelId: 0, message: '还有编辑未保存到本机', detail: '等待右上角显示“已保存到本机”后即可安全关闭。' }); if (answer === 1) event.preventDefault(); });
    let closing = false;
    window.on('close', event => {
      if (closing || !service.jobs.controllers.size) return;
      event.preventDefault();
      const answer = dialog.showMessageBoxSync(window, { type: 'question', buttons: ['继续创作', '停止并退出'], defaultId: 0, cancelId: 0, message: '还有生成任务正在进行', detail: '退出会停止后续生成。已完成的内容会保留，已提交的 OpenAI 请求仍可能计费。' });
      if (answer === 1) { closing = true; for (const controller of service.jobs.controllers.values()) controller.abort(); window.close(); }
    });
    window.once('ready-to-show', () => window.show());
    await window.loadURL(service.url);
  }).catch(error => { dialog.showErrorBox('墨格创作室启动失败', String(error.message || error)); app.quit(); });
  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', () => { if (service) { for (const controller of service.jobs.controllers.values()) controller.abort(); service.server.close(); } });
}
