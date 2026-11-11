'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {spawnSync}=require('node:child_process');
const ROOT=path.resolve(__dirname,'..');

test('Electron-only copy builds and launches without sibling projects or design docs',()=>{
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'dns-independent-'));
  for(const file of ['main.js','preload.js','lib','package.json','webapp','renderer'])fs.cpSync(path.join(ROOT,file),path.join(temp,file),{recursive:true,filter:source=>!source.startsWith(path.join(ROOT,'renderer/generated'))});
  fs.mkdirSync(path.join(temp,'scripts'));fs.copyFileSync(path.join(ROOT,'scripts/build-desktop-assets.cjs'),path.join(temp,'scripts/build-desktop-assets.cjs'));
  const build=spawnSync(process.execPath,['scripts/build-desktop-assets.cjs'],{cwd:temp,encoding:'utf8',windowsHide:true});
  assert.equal(build.status,0,build.stderr);
  for(const file of ['shell.js','workspace.css'])assert.ok(fs.readFileSync(path.join(ROOT,'renderer/generated',file)).equals(fs.readFileSync(path.join(temp,'renderer/generated',file))));
  const profile=path.join(temp,'profile');const env={...process.env,DNS_SMOKE_USER_DATA:profile};delete env.ELECTRON_RUN_AS_NODE;
  const smoke=spawnSync(require('electron'),[temp,'--smoke','--enable-unsafe-swiftshader'],{cwd:temp,env,encoding:'utf8',windowsHide:true,timeout:30000});
  assert.equal(smoke.status,0,(smoke.stderr||'')+(smoke.stdout||''));
  const report=JSON.parse(fs.readFileSync(path.join(profile,'smoke-report.json'),'utf8'));assert.equal(report.allOk,true);
  assert.equal(fs.existsSync(path.join(temp,'docs')),false);assert.equal(fs.existsSync(path.join(temp,'android')),false);
  const pkg=JSON.parse(fs.readFileSync(path.join(ROOT,'package.json'),'utf8'));
  assert.ok(!JSON.stringify(pkg.build).includes('../'));assert.ok(!JSON.stringify(pkg.build).includes('android'));
});
