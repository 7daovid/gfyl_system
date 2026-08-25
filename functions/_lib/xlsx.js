/**
 * 零依赖 XLSX 生成器
 * ------------------------------------------------------------
 * Cloudflare Workers 运行时无法用 Node 的 zlib，也不想引入任何付费/第三方库，
 * 所以这里手写了：CRC32 + ZIP(store 无压缩) + OpenXML 最小骨架。
 * 产出的 .xlsx 可被 Excel / WPS / Numbers 正常打开。
 *
 * 用法：
 *   const buf = buildXlsx([{ name: '原始填报', header: [...], rows: [[...], ...] }]);
 */

/* ------------------------- CRC32 ------------------------- */
const CRC_TABLE = (function () {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(data) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

/* ------------------------- ZIP (store) ------------------------- */
const DOS_TIME = 0;
const DOS_DATE = ((2024 - 1980) << 9) | (1 << 5) | 1; // 2024-01-01

function zipStore(files) {
  const enc = new TextEncoder();
  const locals = [];
  const centrals = [];
  let offset = 0;

  for (let i = 0; i < files.length; i++) {
    const nameBytes = enc.encode(files[i].name);
    const data = files[i].data;
    const crc = crc32(data);

    const local = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);        // version needed
    lv.setUint16(6, 0x0800, true);    // flag: UTF-8 filename
    lv.setUint16(8, 0, true);         // method: store
    lv.setUint16(10, DOS_TIME, true);
    lv.setUint16(12, DOS_DATE, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, data.length, true);
    lv.setUint32(22, data.length, true);
    lv.setUint16(26, nameBytes.length, true);
    lv.setUint16(28, 0, true);
    local.set(nameBytes, 30);
    locals.push(local, data);

    const central = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);        // version made by
    cv.setUint16(6, 20, true);        // version needed
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, DOS_TIME, true);
    cv.setUint16(14, DOS_DATE, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, data.length, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint16(30, 0, true);
    cv.setUint16(32, 0, true);
    cv.setUint16(34, 0, true);
    cv.setUint16(36, 0, true);
    cv.setUint32(38, 0, true);
    cv.setUint32(42, offset, true);
    central.set(nameBytes, 46);
    centrals.push(central);

    offset += local.length + data.length;
  }

  let centralSize = 0;
  for (let i = 0; i < centrals.length; i++) centralSize += centrals[i].length;

  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(4, 0, true);
  ev.setUint16(6, 0, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);
  ev.setUint16(20, 0, true);

  let total = offset + centralSize + 22;
  const out = new Uint8Array(total);
  let p = 0;
  for (let i = 0; i < locals.length; i++) { out.set(locals[i], p); p += locals[i].length; }
  for (let i = 0; i < centrals.length; i++) { out.set(centrals[i], p); p += centrals[i].length; }
  out.set(eocd, p);
  return out;
}

/* ------------------------- OpenXML ------------------------- */
function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    // 去掉 XML 非法控制字符
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
}

function colLetter(n) {
  let s = '';
  n = n + 1;
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function cellXml(ref, value, styleIdx) {
  const st = styleIdx ? ' s="' + styleIdx + '"' : '';
  if (value === null || value === undefined || value === '') {
    return '<c r="' + ref + '"' + st + '/>';
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return '<c r="' + ref + '"' + st + '><v>' + value + '</v></c>';
  }
  return '<c r="' + ref + '"' + st + ' t="inlineStr"><is><t xml:space="preserve">' + esc(value) + '</t></is></c>';
}

function sheetXml(sheet) {
  const header = sheet.header || [];
  const rows = sheet.rows || [];
  const colCount = header.length || (rows[0] ? rows[0].length : 1);

  let cols = '<cols>';
  for (let i = 0; i < colCount; i++) {
    const w = (sheet.widths && sheet.widths[i]) ? sheet.widths[i] : 14;
    cols += '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + w + '" customWidth="1"/>';
  }
  cols += '</cols>';

  let body = '';
  let r = 1;
  if (header.length) {
    body += '<row r="1" ht="20" customHeight="1">';
    for (let c = 0; c < header.length; c++) body += cellXml(colLetter(c) + '1', header[c], 1);
    body += '</row>';
    r = 2;
  }
  for (let i = 0; i < rows.length; i++, r++) {
    body += '<row r="' + r + '">';
    const row = rows[i];
    for (let c = 0; c < row.length; c++) body += cellXml(colLetter(c) + r, row[c], 0);
    body += '</row>';
  }

  const freeze = header.length
    ? '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>'
    : '';

  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    freeze + cols +
    '<sheetData>' + body + '</sheetData>' +
    '</worksheet>';
}

const STYLES_XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
  '<fonts count="2">' +
  '<font><sz val="11"/><color theme="1"/><name val="宋体"/><charset val="134"/></font>' +
  '<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="宋体"/><charset val="134"/></font>' +
  '</fonts>' +
  '<fills count="3">' +
  '<fill><patternFill patternType="none"/></fill>' +
  '<fill><patternFill patternType="gray125"/></fill>' +
  '<fill><patternFill patternType="solid"><fgColor rgb="FF2563EB"/><bgColor indexed="64"/></patternFill></fill>' +
  '</fills>' +
  '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
  '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
  '<cellXfs count="2">' +
  '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="center"/></xf>' +
  '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>' +
  '</cellXfs>' +
  '<cellStyles count="1"><cellStyle name="常规" xfId="0" builtinId="0"/></cellStyles>' +
  '</styleSheet>';

/**
 * @param {Array<{name:string, header:string[], rows:Array<Array>, widths?:number[]}>} sheets
 * @returns {Uint8Array}
 */
export function buildXlsx(sheets) {
  const enc = new TextEncoder();
  const list = (sheets && sheets.length) ? sheets : [{ name: 'Sheet1', header: [], rows: [] }];

  let types = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
    '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>';

  let sheetsTag = '';
  let wbRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">';

  const files = [];

  for (let i = 0; i < list.length; i++) {
    const idx = i + 1;
    types += '<Override PartName="/xl/worksheets/sheet' + idx + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>';
    sheetsTag += '<sheet name="' + esc(list[i].name || ('Sheet' + idx)) + '" sheetId="' + idx + '" r:id="rId' + idx + '"/>';
    wbRels += '<Relationship Id="rId' + idx + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' + idx + '.xml"/>';
    files.push({ name: 'xl/worksheets/sheet' + idx + '.xml', data: enc.encode(sheetXml(list[i])) });
  }

  types += '</Types>';
  wbRels += '<Relationship Id="rId' + (list.length + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>';

  const workbook = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    '<sheets>' + sheetsTag + '</sheets></workbook>';

  const rootRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
    '</Relationships>';

  const all = [
    { name: '[Content_Types].xml', data: enc.encode(types) },
    { name: '_rels/.rels', data: enc.encode(rootRels) },
    { name: 'xl/workbook.xml', data: enc.encode(workbook) },
    { name: 'xl/_rels/workbook.xml.rels', data: enc.encode(wbRels) },
    { name: 'xl/styles.xml', data: enc.encode(STYLES_XML) }
  ].concat(files);

  return zipStore(all);
}

/** 生成下载响应（中文文件名用 RFC 5987 的 filename*，并给出 ASCII 回退名） */
export function xlsxResponse(bytes, filename) {
  const encoded = encodeURIComponent(filename);
  const ascii = filename.replace(/[^\x20-\x7E]/g, '_').replace(/"/g, '');
  return new Response(bytes, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename="' + (ascii || 'export.xlsx') + '"; filename*=UTF-8\'\'' + encoded,
      'Content-Length': String(bytes.length),
      'Cache-Control': 'no-store'
    }
  });
}
