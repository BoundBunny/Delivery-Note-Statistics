'use strict';
// Portable backups contain data.json plus the original, content-addressed images.
// No runtime dependency or old-computer absolute image path is required.
const fs = require('node:fs');
const path = require('node:path');
const { fileURLToPath } = require('node:url');
const { createHash, randomUUID } = require('node:crypto');
const { inflateRawSync } = require('node:zlib');
const MAX_BYTES = 512 * 1024 * 1024, MAX_ENTRY = 128 * 1024 * 1024;
const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp', svg: 'image/svg+xml', avif: 'image/avif' };
const ASSET = /^images\/[a-f0-9]{64}\.(png|jpg|jpeg|gif|webp|bmp|svg|avif)$/;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const crcTable = Array.from({ length: 256 }, (_, n) => { for (let i = 0; i < 8; i++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1; return n >>> 0; });
function crc32(bytes) { let n = 0xffffffff; for (const byte of bytes) n = crcTable[(n ^ byte) & 255] ^ (n >>> 8); return (n ^ 0xffffffff) >>> 0; }
function validName(name) { return name === 'data.json' || ASSET.test(name) || name === 'images/'; }

function zipFiles(files) {
  if (!files.length || files.length > 10000) throw new Error('备份文件数量超出支持范围');
  const local = [], central = [], names = new Set(); let offset = 0, total = 0;
  const now = new Date(), dosDate = (Math.max(0, Math.min(127, now.getFullYear() - 1980)) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
  for (const file of files) {
    if (!validName(file.name) || names.has(file.name)) throw new Error('备份文件名不正确或重复');
    names.add(file.name); total += file.data.length;
    if (file.data.length > MAX_ENTRY || total > MAX_BYTES) throw new Error('备份数据过大，无法生成备份包');
    const name = Buffer.from(file.name), crc = crc32(file.data), header = Buffer.alloc(30), directory = Buffer.alloc(46);
    header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20, 4); header.writeUInt16LE(0x800, 6);
    header.writeUInt16LE(dosTime, 10); header.writeUInt16LE(dosDate, 12);
    header.writeUInt32LE(crc, 14); header.writeUInt32LE(file.data.length, 18); header.writeUInt32LE(file.data.length, 22); header.writeUInt16LE(name.length, 26);
    directory.writeUInt32LE(0x02014b50); directory.writeUInt16LE(20, 4); directory.writeUInt16LE(20, 6); directory.writeUInt16LE(0x800, 8);
    directory.writeUInt16LE(dosTime, 12); directory.writeUInt16LE(dosDate, 14);
    directory.writeUInt32LE(crc, 16); directory.writeUInt32LE(file.data.length, 20); directory.writeUInt32LE(file.data.length, 24);
    directory.writeUInt16LE(name.length, 28); directory.writeUInt32LE(offset, 42);
    local.push(header, name, file.data); central.push(directory, name); offset += header.length + name.length + file.data.length;
  }
  const centralSize = central.reduce((sum, buffer) => sum + buffer.length, 0), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralSize, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, ...central, end]);
}

function unzipFiles(buffer) {
  if (buffer.length > MAX_BYTES || buffer.length < 22) throw new Error('备份包大小不正确');
  let end = -1;
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 65557); i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50 && i + 22 + buffer.readUInt16LE(i + 20) === buffer.length) { end = i; break; }
  }
  if (end < 0 || buffer.readUInt16LE(end + 4) || buffer.readUInt16LE(end + 6)) throw new Error('备份包损坏或不支持分卷');
  const count = buffer.readUInt16LE(end + 10), size = buffer.readUInt32LE(end + 12), start = buffer.readUInt32LE(end + 16);
  if (!count || count > 10000 || count !== buffer.readUInt16LE(end + 8) || start + size !== end) throw new Error('备份包目录不正确');
  const files = new Map(); let p = start, total = 0;
  for (let i = 0; i < count; i++) {
    if (p + 46 > end || buffer.readUInt32LE(p) !== 0x02014b50) throw new Error('备份包目录已损坏');
    const flags = buffer.readUInt16LE(p + 8), method = buffer.readUInt16LE(p + 10), crc = buffer.readUInt32LE(p + 16);
    const packed = buffer.readUInt32LE(p + 20), length = buffer.readUInt32LE(p + 24), nl = buffer.readUInt16LE(p + 28);
    const next = p + 46 + nl + buffer.readUInt16LE(p + 30) + buffer.readUInt16LE(p + 32), at = buffer.readUInt32LE(p + 42);
    if (next > end || at + 30 > start || (flags & 1) || ![0, 8].includes(method) || length > MAX_ENTRY || (total += length) > MAX_BYTES) throw new Error('备份包内容不受支持或过大');
    const name = buffer.subarray(p + 46, p + 46 + nl).toString('utf8');
    if (!validName(name) || files.has(name)) throw new Error('备份包包含不安全或重复的文件名');
    if (buffer.readUInt32LE(at) !== 0x04034b50 || buffer.readUInt16LE(at + 8) !== method || (buffer.readUInt16LE(at + 6) & 1)) throw new Error('备份文件头不正确');
    const localNameLength = buffer.readUInt16LE(at + 26), dataAt = at + 30 + localNameLength + buffer.readUInt16LE(at + 28);
    if (dataAt + packed > start || buffer.subarray(at + 30, at + 30 + localNameLength).toString('utf8') !== name) throw new Error('备份文件范围不正确');
    const source = buffer.subarray(dataAt, dataAt + packed);
    const data = method === 0 ? source : inflateRawSync(source, { maxOutputLength: MAX_ENTRY });
    if (data.length !== length || crc32(data) !== crc) throw new Error('备份文件校验失败：' + name);
    files.set(name, data); p = next;
  }
  if (p !== end || !files.has('data.json')) throw new Error('备份包缺少 data.json 或目录已损坏');
  return files;
}

function imageRecords(backup) {
  const records = Array.isArray(backup.data?.products) ? backup.data.products.filter(p => p && typeof p === 'object') : [];
  if (Array.isArray(backup.catalog?.entries)) for (const entry of backup.catalog.entries) if (entry?.changes && typeof entry.changes === 'object') records.push(entry.changes);
  return records;
}
function imageData(src) {
  const match = /^data:(image\/[a-z0-9.+-]+);base64,([a-z0-9+/]*={0,2})$/i.exec(src);
  if (!match) throw new Error('备份图片编码不正确');
  const ext = Object.keys(MIME).find(key => MIME[key] === match[1].toLowerCase());
  const bytes = Buffer.from(match[2], 'base64');
  if (!ext || !bytes.length || bytes.length > MAX_ENTRY || bytes.toString('base64').replace(/=+$/, '') !== match[2].replace(/=+$/, '')) throw new Error('备份图片内容不正确或过大');
  return { bytes, ext };
}
async function originalImage(src, bundleRoot) {
  if (src.startsWith('data:')) return imageData(src);
  let file = src;
  if (src.startsWith('bundle:')) {
    file = path.resolve(bundleRoot, src.slice(7));
    if (!file.startsWith(path.resolve(bundleRoot) + path.sep)) throw new Error('内置图片路径不正确');
  } else if (/^file:/i.test(src)) file = fileURLToPath(src);
  else if (/^sdimg:/i.test(src)) { const url = new URL(src); if (url.hostname !== 'local') throw new Error('图片地址不正确'); file = url.searchParams.get('p'); }
  if (!file || !path.isAbsolute(file)) throw new Error('商品图片不是可读取的本地原文件：' + src);
  const originalExt = path.extname(file).slice(1).toLowerCase(), ext = originalExt === 'jpeg' ? 'jpg' : originalExt;
  if (!MIME[ext]) throw new Error('不支持的商品图片格式：' + src);
  try {
    const stat = await fs.promises.stat(file);
    if (!stat.isFile() || !stat.size || stat.size > MAX_ENTRY) throw new Error('图片为空或过大');
    return { bytes: await fs.promises.readFile(file), ext };
  } catch (error) { throw new Error('无法读取商品图片原文件，备份未导出：' + src + '（' + error.message + '）'); }
}

async function buildBackupArchive(json, bundleRoot) {
  const backup = JSON.parse(json);
  if (backup.app !== 'songhuodan' || backup.version !== 2 || backup.kind !== 'portable' || !Array.isArray(backup.data?.products)) throw new Error('不是有效的换机备份数据');
  const images = new Map(), cache = new Map();
  for (const record of imageRecords(backup)) {
    if (!record.image) continue;
    if (typeof record.image !== 'string') throw new Error('商品图片资料不正确');
    if (!cache.has(record.image)) cache.set(record.image, await originalImage(record.image, bundleRoot));
    const { bytes, ext } = cache.get(record.image), name = 'images/' + hash(bytes) + '.' + ext;
    images.set(name, bytes); record.image = 'backup:' + name;
  }
  backup.archive = { version: 1 };
  const files = [{ name: 'data.json', data: Buffer.from(JSON.stringify(backup, null, 2)) }, ...Array.from(images, ([name, data]) => ({ name, data }))];
  return { bytes: zipFiles(files), imageCount: images.size };
}

async function removeImportFolder(folder, root) {
  if (path.dirname(path.resolve(folder)) !== path.resolve(root) || !/^restore-[a-f0-9-]+$/.test(path.basename(folder))) throw new Error('恢复图片目录不正确');
  await fs.promises.rm(folder, { recursive: true, force: true });
}
async function prepareBackupImport(filePath, imageRoot, decodeText = bytes => new TextDecoder('utf-8', { fatal: true }).decode(bytes)) {
  const stat = await fs.promises.stat(filePath);
  if (stat.size > MAX_BYTES) throw new Error('备份文件过大');
  const source = await fs.promises.readFile(filePath), zipped = source.length > 3 && source.readUInt32LE(0) === 0x04034b50;
  const files = zipped ? unzipFiles(source) : null;
  const backup = JSON.parse(decodeText(files ? files.get('data.json') : source));
  if (files && (backup.app !== 'songhuodan' || backup.version !== 2 || backup.kind !== 'portable' || backup.archive?.version !== 1)) throw new Error('不是有效的送货宝图片备份包');
  const assets = new Map(), links = [];
  for (const record of imageRecords(backup)) {
    const src = record.image;
    if (typeof src !== 'string' || !src) continue;
    let image;
    if (src.startsWith('backup:')) {
      const name = src.slice(7);
      if (!ASSET.test(name)) throw new Error('备份图片路径不正确');
      const bytes = files ? files.get(name) : await fs.promises.readFile(path.join(path.dirname(filePath), name));
      if (!bytes || hash(bytes) !== path.basename(name).split('.')[0]) throw new Error('备份图片缺失或校验失败：' + name);
      image = { bytes, ext: path.extname(name).slice(1) };
    } else if (src.startsWith('data:')) image = imageData(src);
    else if (files) throw new Error('备份包中的图片未打包完整：' + src);
    else continue; // Legacy path-only JSON cannot supply missing external image bytes.
    const name = hash(image.bytes) + '.' + image.ext;
    assets.set(name, image.bytes); links.push({ record, name });
  }
  if (!assets.size) return { text: JSON.stringify(backup), imageCount: 0 };
  const root = path.resolve(imageRoot), folder = path.join(root, 'restore-' + randomUUID());
  await fs.promises.mkdir(root, { recursive: true });
  await fs.promises.mkdir(folder);
  try {
    for (const [name, bytes] of assets) await fs.promises.writeFile(path.join(folder, name), bytes, { flag: 'wx' });
    for (const { record, name } of links) record.image = path.join(folder, name);
    return { text: JSON.stringify(backup), imageCount: assets.size, folder, root };
  } catch (error) { await removeImportFolder(folder, root); throw error; }
}

module.exports = { buildBackupArchive, prepareBackupImport, removeImportFolder, zipFiles, unzipFiles };
