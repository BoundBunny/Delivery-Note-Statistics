'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { createHash } = require('node:crypto');
const { buildBackupArchive, prepareBackupImport, removeImportFolder, zipFiles, unzipFiles } = require('../lib/backup-archive.js');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dns-image-package-'));
  const photo = path.join(root, 'original.png'), bytes = Buffer.from('original-image-binary-\u0000\u0001'); fs.writeFileSync(photo, bytes);
  const backup = { app: 'songhuodan', version: 2, kind: 'portable', data: {
    settings: {}, customers: [], orders: [], lastPrices: {}, seqMap: {}, products: [{ id: 'p1', name: '自建商品', image: photo }],
  }, catalog: { entries: [{ id: 'builtin', key: 'barcode:001', changes: { image: photo }, unset: [] }] } };
  return { root, photo, bytes, backup, images: path.join(root, 'new-computer', 'images') };
}
async function archiveFixture() {
  const f = fixture(), archive = await buildBackupArchive(JSON.stringify(f.backup), f.root), file = path.join(f.root, 'transfer.zip');
  fs.writeFileSync(file, archive.bytes); return { ...f, archive, file };
}

test('backup package stores raw originals once and keeps JSON free of old-computer paths', async () => {
  const f = await archiveFixture(), files = unzipFiles(f.archive.bytes), backup = JSON.parse(files.get('data.json'));
  assert.equal(f.archive.imageCount, 1); assert.equal(files.size, 2);
  const image = backup.data.products[0].image;
  assert.equal(image, 'backup:images/' + hash(f.bytes) + '.png'); assert.ok(files.get(image.slice(7)).equals(f.bytes));
  assert.equal(backup.catalog.entries[0].changes.image, image);
  assert.equal(f.backup.data.products[0].image, f.photo);
});

test('ZIP restores original image files to the new computer with no source picture available', async () => {
  const f = await archiveFixture(); fs.unlinkSync(f.photo);
  const result = await prepareBackupImport(f.file, f.images), backup = JSON.parse(result.text);
  assert.equal(result.imageCount, 1); assert.ok(fs.readFileSync(backup.data.products[0].image).equals(f.bytes));
  assert.ok(backup.data.products[0].image.startsWith(f.images + path.sep));
  assert.equal(backup.data.products[0].image, backup.catalog.entries[0].changes.image);
  await removeImportFolder(result.folder, result.root); assert.equal(fs.existsSync(result.folder), false);
});

test('unpacked JSON and its adjacent images folder can also be imported', async () => {
  const f = await archiveFixture(), files = unzipFiles(f.archive.bytes), unpacked = path.join(f.root, 'unpacked');
  for (const [name, bytes] of files) { const target = path.join(unpacked, name); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, bytes); }
  const result = await prepareBackupImport(path.join(unpacked, 'data.json'), f.images);
  assert.ok(fs.readFileSync(JSON.parse(result.text).data.products[0].image).equals(f.bytes));
});

test('old JSON with embedded images restores real files instead of old directory strings', async () => {
  const f = fixture(); f.backup.data.products[0].image = 'data:image/png;base64,' + f.bytes.toString('base64'); f.backup.catalog.entries = [];
  const file = path.join(f.root, 'old.json'); fs.writeFileSync(file, JSON.stringify(f.backup));
  const result = await prepareBackupImport(file, f.images); const image = JSON.parse(result.text).data.products[0].image;
  assert.ok(path.isAbsolute(image)); assert.ok(fs.readFileSync(image).equals(f.bytes));
});

test('missing or hash-mismatched package pictures fail before creating restored files', async () => {
  const f = await archiveFixture(), files = unzipFiles(f.archive.bytes), manifest = files.get('data.json'), imageName = [...files.keys()].find(name => name.startsWith('images/'));
  for (const entries of [[{ name: 'data.json', data: manifest }], [{ name: 'data.json', data: manifest }, { name: imageName, data: Buffer.from('changed') }]]) {
    fs.writeFileSync(f.file, zipFiles(entries)); await assert.rejects(prepareBackupImport(f.file, f.images), /图片缺失|校验失败/);
    assert.equal(fs.existsSync(f.images), false);
  }
});

test('damaged image bytes fail ZIP CRC verification', async () => {
  const f = await archiveFixture(), bytes = Buffer.from(f.archive.bytes), at = bytes.indexOf(f.bytes); assert.ok(at > 0);
  bytes[at] ^= 1; assert.throws(() => unzipFiles(bytes), /校验失败/);
});

test('ZIP reader also accepts deflated data from a normally recompressed backup', () => {
  const original = Buffer.from(JSON.stringify({ example: 'valid JSON '.repeat(100) }));
  const plain = zipFiles([{ name: 'data.json', data: original }]);
  const compressed = zipFiles([{ name: 'data.json', data: require('node:zlib').deflateRawSync(original) }]);
  const central = compressed.readUInt32LE(compressed.length - 6), crc = plain.readUInt32LE(14);
  compressed.writeUInt16LE(8, 8); compressed.writeUInt16LE(8, central + 10);
  compressed.writeUInt32LE(crc, 14); compressed.writeUInt32LE(crc, central + 16);
  compressed.writeUInt32LE(original.length, 22); compressed.writeUInt32LE(original.length, central + 24);
  assert.ok(unzipFiles(compressed).get('data.json').equals(original));
});

test('backup archives reject unsupported or unsafe entry names and duplicate files', () => {
  for (const name of ['../outside.png', '/absolute.png', 'images/../../outside.png', 'images\\outside.png']) assert.throws(() => zipFiles([{ name, data: Buffer.from('x') }]), /文件名/);
  assert.throws(() => zipFiles([{ name: 'data.json', data: Buffer.from('{}') }, { name: 'data.json', data: Buffer.from('{}') }]), /重复/);
  const bytes = zipFiles([{ name: 'data.json', data: Buffer.from('{}') }]);
  for (let at = bytes.indexOf('data.json'); at >= 0; at = bytes.indexOf('data.json', at + 9)) bytes.write('evil.json', at);
  assert.throws(() => unzipFiles(bytes), /不安全/);
});

test('cleanup cannot remove an unrelated directory', async () => {
  const f = fixture(); await assert.rejects(removeImportFolder(f.root, f.images), /目录不正确/); assert.ok(fs.existsSync(f.photo));
});

test('missing source originals stop export instead of retaining empty directory references', async () => {
  const f = fixture(); fs.unlinkSync(f.photo); await assert.rejects(buildBackupArchive(JSON.stringify(f.backup), f.root), /原文件.*备份未导出/);
});

test('custom products using bundled pictures also get actual image files in the archive', async () => {
  const f = fixture(); f.backup.data.products[0].image = 'bundle:original.png'; f.backup.catalog.entries = [];
  const result = await buildBackupArchive(JSON.stringify(f.backup), f.root), files = unzipFiles(result.bytes);
  assert.equal(result.imageCount, 1); assert.ok([...files.values()].some(bytes => bytes.equals(f.bytes)));
});

test('a no-picture backup remains importable without creating an empty image directory', async () => {
  const f = fixture(); f.backup.data.products[0].image = ''; f.backup.catalog.entries = [];
  const result = await buildBackupArchive(JSON.stringify(f.backup), f.root), file = path.join(f.root, 'empty.zip'); fs.writeFileSync(file, result.bytes);
  const imported = await prepareBackupImport(file, f.images); assert.equal(imported.imageCount, 0); assert.equal(fs.existsSync(f.images), false);
});
