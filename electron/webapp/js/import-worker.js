'use strict';
importScripts('vendor/sheetjs-0.20.3.full.min.js', 'table-import.js');
self.onmessage = event => {
  try { self.postMessage({ ok: true, ...TableImport.read(event.data.buffer, event.data.kind) }); }
  catch (error) { self.postMessage({ ok: false, error: error.message || '资料解析失败' }); }
};
