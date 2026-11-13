/* Local-only Excel/CSV decoding shared by the import worker and Node tests. */
'use strict';
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./vendor/sheetjs-0.20.3.full.min.js'));
  else root.TableImport = factory(root.XLSX);
})(typeof self !== 'undefined' ? self : this, function (XLSX) {
  const MAX_BYTES = 32 * 1024 * 1024, MAX_ROWS = 100000, MAX_COLUMNS = 128, HEADER_ROWS = 50;
  const clean = value => String(value == null ? '' : value).replace(/^\uFEFF/, '').trim();
  const normalizeHeader = value => clean(value).replace(/\s/g, '');
  function nameColumn(value, kind) {
    const header = normalizeHeader(value);
    return kind === 'products' ? /^(?:(?:产品|商品|货品)(?:名称|名)|名称|品名|productname|name)$/i.test(header)
      : /^(?:客户名称|客户名|名称|姓名|customer(?:name)?|name)$/i.test(header);
  }
  function findHeader(rows, kind) {
    for (let row = 0; row < Math.min(rows.length, HEADER_ROWS); row++) {
      if (rows[row].some(value => nameColumn(value, kind))) return row;
    }
    return -1;
  }
  function decodeText(bytes) {
    let text;
    if (bytes[0] === 0xff && bytes[1] === 0xfe) text = new TextDecoder('utf-16le', { fatal: true }).decode(bytes);
    else if (bytes[0] === 0xfe && bytes[1] === 0xff) text = new TextDecoder('utf-16be', { fatal: true }).decode(bytes);
    else {
      try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
      catch (_) {
        if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) throw new Error('UTF-8 文件已损坏，请检查原文件');
        text = new TextDecoder('gb18030', { fatal: true }).decode(bytes);
      }
    }
    if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\uFFFD]/.test(text)) throw new Error('文件包含乱码或二进制内容，请选择 Excel 或 CSV 资料文件');
    return text.replace(/^\uFEFF/, '');
  }
  function csvRows(text, separator) {
    const rows = []; let row = [], value = '', quoted = false, closed = false;
    for (let i = 0; i < text.length; i++) {
      const character = text[i];
      if (quoted) {
        if (character === '"' && text[i + 1] === '"') { value += '"'; i++; }
        else if (character === '"') { quoted = false; closed = true; }
        else value += character;
      } else if (character === separator) { row.push(value); value = ''; closed = false; }
      else if (character === '\r' || character === '\n') {
        if (character === '\r' && text[i + 1] === '\n') i++;
        row.push(value); if (row.some(cell => cell.trim())) rows.push(row);
        row = []; value = ''; closed = false;
      } else if (character === '"') {
        if (value.trim() || closed) throw new Error('CSV 引号格式不正确');
        value = ''; quoted = true;
      } else if (closed && character.trim()) throw new Error('CSV 引号后有无效内容');
      else if (!closed) value += character;
      if (rows.length > MAX_ROWS + HEADER_ROWS || row.length > MAX_COLUMNS) throw new Error('资料行数或列数超出支持范围');
    }
    if (quoted) throw new Error('CSV 引号未闭合');
    row.push(value); if (row.some(cell => cell.trim())) rows.push(row);
    return rows;
  }
  function readCSV(bytes, kind) {
    const text = decodeText(bytes);
    if (/^\s*(?:\{\s*"|\[|<!doctype|<html|<\?xml)/i.test(text)) throw new Error('请选择 Excel 或 CSV 商品/客户资料，不能导入备份或其他文档');
    let quoteError;
    for (const separator of [',', '\t', ';']) {
      let rows;
      try { rows = csvRows(text, separator); }
      catch (error) { quoteError = error; continue; }
      const header = findHeader(rows, kind);
      if (header < 0) continue;
      rows = rows.slice(header);
      if (rows[0].length > MAX_COLUMNS || rows.length > MAX_ROWS + 1 || rows.some(row => row.length > rows[0].length)) throw new Error('CSV 列数不正确，请检查分隔符或引号');
      // Our CSV export protects formula-like text with an apostrophe. Remove
      // that one transport prefix on import; never evaluate it as a formula.
      rows = rows.map((row, index) => index ? row.map(cell => /^'(?:[\s\uFEFF]*[=+\-@]|[\t\r\n])/.test(cell) ? cell.slice(1) : cell) : row);
      return { format: 'CSV', sheets: [{ name: 'CSV', rows }] };
    }
    if (quoteError) throw quoteError;
    throw new Error('未识别到“' + (kind === 'products' ? '产品名称' : '客户名称') + '”表头，请选择对应资料文件');
  }
  function workbookRows(workbook, kind) {
    const sheets = []; let total = 0;
    for (const name of workbook.SheetNames) {
      const metadata = workbook.Workbook?.Sheets?.find(sheet => sheet.name === name);
      if (metadata?.Hidden) continue;
      const sheet = workbook.Sheets[name]; if (!sheet || !sheet['!ref']) continue;
      const range = XLSX.utils.decode_range(sheet['!ref']);
      if (range.e.c >= MAX_COLUMNS || range.e.r - range.s.r >= MAX_ROWS + HEADER_ROWS) throw new Error('工作表“' + name + '”行数或列数超出支持范围');
      const headerRows = [];
      for (let row = range.s.r; row <= Math.min(range.e.r, range.s.r + HEADER_ROWS - 1); row++) {
        const values = [];
        for (let column = range.s.c; column <= range.e.c; column++) values.push(clean(sheet[XLSX.utils.encode_cell({ r: row, c: column })]?.v));
        headerRows.push(values);
      }
      const header = findHeader(headerRows, kind); if (header < 0) continue;
      const headers = headerRows[header];
      const rows = [headers];
      for (let row = range.s.r + header + 1; row <= range.e.r; row++) {
        const values = [];
        for (let column = range.s.c; column <= range.e.c; column++) {
          const cell = sheet[XLSX.utils.encode_cell({ r: row, c: column })];
          if (!cell || cell.v == null && !cell.f) { values.push(''); continue; }
          const address = name + '!' + XLSX.utils.encode_cell({ r: row, c: column });
          if (cell.t === 'e' || cell.f && cell.v == null) throw new Error(address + ' 存在错误或未计算的公式，请在 Excel 中计算并保存后重试');
          const header = headers[column - range.s.c];
          const money = kind === 'products' && /零售价|价格|售价|单价|成本/.test(header);
          const identity = /条码|编号|编码|电话|手机/.test(header);
          if (identity && cell.t === 'n' && !Number.isSafeInteger(cell.v)) throw new Error(address + ' 的编号、条码或电话超出精确数字范围，请将该列设为文本并核对原值');
          const rawIdentity = identity && cell.t === 'n' && (!cell.z || cell.z === 'General' || /e[+-]\d+$/i.test(cell.w || ''));
          values.push(money && cell.t === 'n' ? cell.v : rawIdentity ? String(cell.v) : (cell.w != null ? String(cell.w) : String(cell.v == null ? '' : cell.v)));
        }
        if (!values.some(value => clean(value))) continue;
        total++; if (total > MAX_ROWS) throw new Error('导入记录超过 ' + MAX_ROWS + ' 行，请拆分文件');
        rows.push(values);
      }
      if (rows.length > 1) sheets.push({ name, rows });
    }
    if (!sheets.length) throw new Error('Excel 中没有找到包含“' + (kind === 'products' ? '产品名称' : '客户名称') + '”表头的有效资料');
    return sheets;
  }
  function checkZip(bytes) {
    if (bytes.length < 22) throw new Error('Excel 文件已损坏');
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength); let end = -1;
    for (let at = bytes.length - 22; at >= Math.max(0, bytes.length - 65557); at--) {
      if (view.getUint32(at, true) === 0x06054b50 && at + 22 + view.getUint16(at + 20, true) === bytes.length) { end = at; break; }
    }
    if (end < 0 || view.getUint16(end + 4, true) || view.getUint16(end + 6, true)) throw new Error('Excel 文件已损坏或不是普通工作簿');
    const count = view.getUint16(end + 10, true), start = view.getUint32(end + 16, true), size = view.getUint32(end + 12, true);
    if (!count || count > 10000 || start + size !== end) throw new Error('Excel 文件目录不正确');
    let at = start, total = 0;
    for (let i = 0; i < count; i++) {
      if (at + 46 > end || view.getUint32(at, true) !== 0x02014b50 || view.getUint16(at + 8, true) & 1) throw new Error('Excel 文件已损坏或加密');
      total += view.getUint32(at + 24, true);
      if (total > 128 * 1024 * 1024) throw new Error('Excel 解压后数据过大，请拆分文件');
      at += 46 + view.getUint16(at + 28, true) + view.getUint16(at + 30, true) + view.getUint16(at + 32, true);
    }
    if (at !== end) throw new Error('Excel 文件目录已损坏');
  }
  function read(input, kind) {
    if (kind !== 'products' && kind !== 'customers') throw new Error('不支持的资料类型');
    const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
    if (!bytes.length || bytes.length > MAX_BYTES) throw new Error('请选择非空且不超过 32 MB 的资料文件');
    const zip = bytes[0] === 0x50 && bytes[1] === 0x4b;
    const ole = bytes.length >= 8 && [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1].every((value, index) => bytes[index] === value);
    const biff = bytes[0] === 9 && [0, 2, 4, 8].includes(bytes[1]);
    if (!zip && !ole && !biff) return readCSV(bytes, kind);
    if (zip) checkZip(bytes);
    let workbook;
    try { workbook = XLSX.read(bytes, { type: 'array', cellText: true, cellNF: true, cellFormula: true, sheetStubs: true }); }
    catch (_) { throw new Error('Excel 文件已损坏、加密或不是有效工作簿，请检查原文件'); }
    return { format: 'Excel', sheets: workbookRows(workbook, kind) };
  }
  return { read, MAX_BYTES };
});
