/* ============================================================
 * xlsx.js — 极简 Excel .xlsx 生成器（零依赖，离线可用）
 * 通过 ZIP(STORE) + 最小 OOXML 结构实现，支持多 Sheet、
 * 标题合并行、表头/数据/合计样式。
   * API: Xlsx.build([{name, title, headers, rows, widths, footer, note}]) -> Uint8Array
 * ============================================================ */
'use strict';
(function () {
  var enc = new TextEncoder();

  function escXml(s) {
    // SpreadsheetML escapes UTF-16 code units with _xHHHH_. Protect literal
    // escape-looking text first, then encode controls and unpaired surrogates.
    var text = String(s == null ? '' : s).replace(/_x[0-9a-f]{4}_/gi, function (match) { return '_x005F_' + match.slice(1); });
    var encoded = '';
    for (var i = 0; i < text.length; i++) {
      var code = text.charCodeAt(i);
      if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length && text.charCodeAt(i + 1) >= 0xdc00 && text.charCodeAt(i + 1) <= 0xdfff) {
        encoded += text[i] + text[++i];
      } else if ((code < 32 && code !== 9 && code !== 10) || code === 0xfffe || code === 0xffff || (code >= 0xd800 && code <= 0xdfff)) {
        encoded += '_x' + code.toString(16).toUpperCase().padStart(4, '0') + '_';
      } else encoded += text[i];
    }
    return encoded
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
  }

  function colLetter(n) { // 0 -> A
    var s = '';
    n = n + 1;
    while (n > 0) {
      var m = (n - 1) % 26;
      s = String.fromCharCode(65 + m) + s;
      n = Math.floor((n - 1) / 26);
    }
    return s;
  }

  /* ---- CRC32 ---- */
  var crcTable = (function () {
    var t = new Uint32Array(256);
    for (var i = 0; i < 256; i++) {
      var c = i;
      for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[i] = c >>> 0;
    }
    return t;
  })();
  function crc32(bytes) {
    var c = 0xFFFFFFFF;
    for (var i = 0; i < bytes.length; i++) c = crcTable[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  /* ---- ZIP (STORE, 无压缩) ---- */
  function zipStore(files) {
    var localParts = [], centralParts = [];
    var offset = 0;
    for (var i = 0; i < files.length; i++) {
      var f = files[i];
      var name = enc.encode(f.name);
      var crc = crc32(f.data);
      var size = f.data.length;

      var lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true);
      lh.setUint16(4, 20, true);
      lh.setUint16(6, 0, true);
      lh.setUint16(8, 0, true);
      lh.setUint16(10, 0, true);
      lh.setUint16(12, 0, true);
      lh.setUint32(14, crc, true);
      lh.setUint32(18, size, true);
      lh.setUint32(22, size, true);
      lh.setUint16(26, name.length, true);
      lh.setUint16(28, 0, true);
      localParts.push(new Uint8Array(lh.buffer), name, f.data);

      var ch = new DataView(new ArrayBuffer(46));
      ch.setUint32(0, 0x02014b50, true);
      ch.setUint16(4, 20, true);
      ch.setUint16(6, 20, true);
      ch.setUint16(8, 0, true);
      ch.setUint16(10, 0, true);
      ch.setUint16(12, 0, true);
      ch.setUint16(14, 0, true);
      ch.setUint32(16, crc, true);
      ch.setUint32(20, size, true);
      ch.setUint32(24, size, true);
      ch.setUint16(28, name.length, true);
      ch.setUint16(30, 0, true);
      ch.setUint16(32, 0, true);
      ch.setUint16(34, 0, true);
      ch.setUint16(36, 0, true);
      ch.setUint32(38, 0, true);
      ch.setUint32(42, offset, true);
      centralParts.push(new Uint8Array(ch.buffer), name);
      offset += 30 + name.length + size;
    }

    var cdSize = 0;
    for (var j = 0; j < centralParts.length; j++) cdSize += centralParts[j].length;
    var cdOffset = offset;

    var eocd = new DataView(new ArrayBuffer(22));
    eocd.setUint32(0, 0x06054b50, true);
    eocd.setUint16(4, 0, true);
    eocd.setUint16(6, 0, true);
    eocd.setUint16(8, files.length, true);
    eocd.setUint16(10, files.length, true);
    eocd.setUint32(12, cdSize, true);
    eocd.setUint32(16, cdOffset, true);
    eocd.setUint16(20, 0, true);

    var total = cdSize + cdOffset + 22;
    var out = new Uint8Array(total);
    var pos = 0;
    for (var a = 0; a < localParts.length; a++) { out.set(localParts[a], pos); pos += localParts[a].length; }
    for (var b = 0; b < centralParts.length; b++) { out.set(centralParts[b], pos); pos += centralParts[b].length; }
    out.set(new Uint8Array(eocd.buffer), pos);
    return out;
  }

  /* ---- Sheet XML ---- */
  function sheetXml(sheet) {
    var headers = sheet.headers || [];
    var rows = sheet.rows || [];
    var widths = sheet.widths || [];
    var nCols = Math.max(headers.length, 1);
    for (var r = 0; r < rows.length; r++) nCols = Math.max(nCols, rows[r].length);
    if (sheet.footer) nCols = Math.max(nCols, sheet.footer.length);

    var parts = [];
    parts.push('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>');
    parts.push('<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">');

    if (widths.length) {
      var cols = '<cols>';
      for (var w = 0; w < nCols; w++) {
        var cw = widths[w] || 10;
        cols += '<col min="' + (w + 1) + '" max="' + (w + 1) + '" width="' + cw + '" customWidth="1"/>';
      }
      parts.push(cols + '</cols>');
    }

    parts.push('<sheetData>');
    var rowIdx = 1;

    function cell(ref, v, s, isNum) {
      if (isNum && typeof v === 'number') {
        return '<c r="' + ref + '"' + (s != null ? ' s="' + s + '"' : '') + '><v>' + v + '</v></c>';
      }
      return '<c r="' + ref + '"' + (s != null ? ' s="' + s + '"' : '') + ' t="inlineStr"><is><t xml:space="preserve">' + escXml(v == null ? '' : v) + '</t></is></c>';
    }

    // 标题（合并首行）
    if (sheet.title) {
      parts.push('<row r="' + rowIdx + '" ht="28" customHeight="1">' +
        '<c r="A' + rowIdx + '" s="4" t="inlineStr"><is><t xml:space="preserve">' + escXml(sheet.title) + '</t></is></c></row>');
      rowIdx++;
    }
    // 表头
    if (headers.length) {
      var hd = '';
      for (var h = 0; h < nCols; h++) hd += cell(colLetter(h) + rowIdx, headers[h], 1);
      parts.push('<row r="' + rowIdx + '" ht="20" customHeight="1">' + hd + '</row>');
      rowIdx++;
    }
    // 数据
    for (var d = 0; d < rows.length; d++) {
      var cells = '';
      for (var c2 = 0; c2 < nCols; c2++) {
        var v = rows[d][c2];
        cells += cell(colLetter(c2) + rowIdx, typeof v === 'number' ? v : (v == null ? '' : v), 2, typeof v === 'number');
      }
      parts.push('<row r="' + rowIdx + '">' + cells + '</row>');
      rowIdx++;
    }
    // 合计
    var merges = [];
    if (sheet.footer) {
      // footerMerge: [{from,to}] 列下标区间，将合计行的这些列合并为一个单元格
      var fmerge = sheet.footerMerge || [];
      var skip = {};
      for (var fm = 0; fm < fmerge.length; fm++) {
        var rg = fmerge[fm];
        for (var k2 = rg.from + 1; k2 <= rg.to; k2++) skip[k2] = true;
        if (rg.to > rg.from) merges.push(colLetter(rg.from) + rowIdx + ':' + colLetter(rg.to) + rowIdx);
      }
      var fc = '';
      for (var f = 0; f < nCols; f++) {
        if (skip[f]) continue;
        var fv = sheet.footer[f];
        fc += cell(colLetter(f) + rowIdx, typeof fv === 'number' ? fv : (fv == null ? '' : fv), 3, typeof fv === 'number');
      }
      parts.push('<row r="' + rowIdx + '" ht="20" customHeight="1">' + fc + '</row>');
      rowIdx++;
    }

    // Keep bill-wide notes below the total. Split long lines into native
    // merged rows so even a long note is visible without Excel auto-fit.
    if (sheet.note != null && String(sheet.note) !== '') {
      var capacity = Math.max(16, Math.floor(Array.from({ length: nCols }, function (_, index) { return widths[index] || 10; }).reduce(function (a, b) { return a + b; }, 0) - 4));
      String(sheet.note).split(/\r\n|\r|\n/).forEach(function (line) {
        var chunks = [], chunk = '', units = 0;
        for (var character of line) {
          var size = character.codePointAt(0) > 255 ? 2 : 1;
          if (units + size > capacity && chunk) { chunks.push(chunk); chunk = ''; units = 0; }
          chunk += character; units += size;
        }
        chunks.push(chunk);
        chunks.forEach(function (value) {
          parts.push('<row r="' + rowIdx + '" ht="22" customHeight="1">' + cell('A' + rowIdx, value, 5) + '</row>');
          if (nCols > 1) merges.push('A' + rowIdx + ':' + colLetter(nCols - 1) + rowIdx);
          rowIdx++;
        });
      });
    }

    parts.push('</sheetData>');
    if (sheet.title) {
      merges.unshift('A1:' + colLetter(nCols - 1) + '1');
    }
    if (merges.length) {
      parts.push('<mergeCells count="' + merges.length + '">' +
        merges.map(function (m) { return '<mergeCell ref="' + m + '"/>'; }).join('') +
        '</mergeCells>');
    }
    parts.push('</worksheet>');
    return parts.join('');
  }

  var STYLES_XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<fonts count="3">' +
    '<font><sz val="11"/><name val="宋体"/></font>' +
    '<font><b/><sz val="11"/><name val="宋体"/></font>' +
    '<font><b/><sz val="14"/><name val="宋体"/></font>' +
    '</fonts>' +
    '<fills count="2">' +
    '<fill><patternFill patternType="none"/></fill>' +
    '<fill><patternFill patternType="gray125"/></fill>' +
    '</fills>' +
    '<borders count="2">' +
    '<border><left/><right/><top/><bottom/><diagonal/></border>' +
    '<border><left style="thin"><color rgb="FF000000"/></left><right style="thin"><color rgb="FF000000"/></right><top style="thin"><color rgb="FF000000"/></top><bottom style="thin"><color rgb="FF000000"/></bottom><diagonal/></border>' +
    '</borders>' +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    '<cellXfs count="6">' +
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
    '<xf numFmtId="0" fontId="1" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>' +
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1"/>' +
    '<xf numFmtId="0" fontId="1" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1"/>' +
    '<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>' +
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="left" vertical="center" wrapText="1"/></xf>' +
    '</cellXfs>' +
    '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
    '</styleSheet>';

  function build(sheets) {
    // Customer names become sheet names. Sanitize them centrally and retain
    // uniqueness after truncation (Excel compares names without case).
    var usedNames = new Set();
    var sheetNames = sheets.map(function (sheet, index) {
      var base = String(sheet.name || '').replace(/[\\/\[\]:*?\u0000-\u001f]/g, '_').trim().replace(/^'+|'+$/g, '');
      if (!base) base = 'Sheet' + (index + 1);
      var name = base.slice(0, 31).replace(/'+$/g, '');
      var suffix = 1;
      while (usedNames.has(name.toLowerCase())) {
        var tail = ' (' + (++suffix) + ')';
        name = base.slice(0, 31 - tail.length) + tail;
      }
      usedNames.add(name.toLowerCase());
      return name;
    });
    var files = [];
    var sheetRels = '';
    var sheetOverrides = '';
    for (var i = 0; i < sheets.length; i++) {
      files.push({ name: 'xl/worksheets/sheet' + (i + 1) + '.xml', data: enc.encode(sheetXml(sheets[i])) });
      sheetRels += '<Relationship Id="rId' + (i + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' + (i + 1) + '.xml"/>';
      sheetOverrides += '<Override PartName="/xl/worksheets/sheet' + (i + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>';
    }
    var styleRid = sheets.length + 1;
    sheetRels += '<Relationship Id="rId' + styleRid + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>';

    var sheetTags = '';
    for (var s = 0; s < sheets.length; s++) {
      sheetTags += '<sheet name="' + escXml(sheetNames[s]) + '" sheetId="' + (s + 1) + '" r:id="rId' + (s + 1) + '"/>';
    }

    var workbook = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      '<sheets>' + sheetTags + '</sheets></workbook>';

    var wbRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + sheetRels + '</Relationships>';

    var contentTypes = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      sheetOverrides +
      '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
      '</Types>';

    var rootRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
      '</Relationships>';

    files.push({ name: '[Content_Types].xml', data: enc.encode(contentTypes) });
    files.push({ name: '_rels/.rels', data: enc.encode(rootRels) });
    files.push({ name: 'xl/workbook.xml', data: enc.encode(workbook) });
    files.push({ name: 'xl/_rels/workbook.xml.rels', data: enc.encode(wbRels) });
    files.push({ name: 'xl/styles.xml', data: enc.encode(STYLES_XML) });

    return zipStore(files);
  }

  window.Xlsx = { build: build };
})();
