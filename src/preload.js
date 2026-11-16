// Most między interfejsem a procesem głównym
'use strict';
const { contextBridge, ipcRenderer, webUtils } = require('electron');
const path = require('path');

async function call(ch, ...args) {
  const r = await ipcRenderer.invoke(ch, ...args);
  if (!r.ok) throw new Error(r.error);
  return r.data;
}
const on = (ch, fn) => { const h = (_e, d) => fn(d); ipcRenderer.on(ch, h); return () => ipcRenderer.removeListener(ch, h); };

contextBridge.exposeInMainWorld('cm', {
  call, on,
  pathForFile: f => (webUtils && webUtils.getPathForFile ? webUtils.getPathForFile(f) : f.path),
  path: { join: (...a) => path.join(...a), basename: (p, e) => path.basename(p, e), dirname: p => path.dirname(p), extname: p => path.extname(p), sep: path.sep, relative: (a, b) => path.relative(a, b) },
  monacoBase: 'file:///' + path.join(__dirname, '..', 'node_modules', 'monaco-editor', 'min').replace(/\\/g, '/').replace(/^\/+/, ''),
  platform: process.platform,
});
