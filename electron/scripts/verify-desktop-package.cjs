'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {spawnSync}=require('node:child_process');
const ROOT=path.resolve(__dirname,'..');
const builder=path.dirname(require.resolve('electron-builder'));
const library=path.dirname(require.resolve('app-builder-lib',{paths:[builder]}));
const asar=require(require.resolve('@electron/asar',{paths:[library]}));
const sevenZip=require(require.resolve('7zip-bin',{paths:[library]})).path7za;
// Optional output directory keeps independent release checks from sharing a build.
const releaseDir=path.resolve(ROOT,process.argv[2]||'dist');
const folder=path.join(releaseDir,'win-unpacked');
const archive=path.join(folder,'resources/app.asar');
const output=path.resolve(ROOT,process.argv[3]||(process.argv[2]?'.shots/fixed-workspace/package':'.shots/standalone'));fs.mkdirSync(output,{recursive:true});
const files=asar.listPackage(archive).map(file=>file.replaceAll('\\','/'));
if(files.some(file=>file.includes('docs/dns-workspace/workspace.js')||file.includes('/tests/')))throw new Error('Prototype/test controller leaked into the production bundle');
const checked=[];
const packagedFiles=['main.js','preload.js','lib/data-store.js','renderer/desktop.js','renderer/desktop.css','renderer/warehouse-scene.js','renderer/generated/shell.js','renderer/generated/workspace.css'];
for(const file of packagedFiles){
  if(!asar.extractFile(archive,path.normalize(file)).equals(fs.readFileSync(path.join(ROOT,file))))throw new Error('Bundled source differs: '+file);
  checked.push(file);
}
const shared=path.join(ROOT,'webapp');
function walk(dir){for(const entry of fs.readdirSync(dir,{withFileTypes:true})){const absolute=path.join(dir,entry.name);if(entry.isDirectory())walk(absolute);else{const relative=path.relative(shared,absolute);const bundled='webapp/'+relative.replaceAll('\\','/');if(!fs.readFileSync(absolute).equals(asar.extractFile(archive,path.normalize(bundled))))throw new Error('Bundled web resource differs: '+relative);checked.push('webapp/'+relative.replaceAll('\\','/'));}}}
walk(shared);
for(const forbidden of ['/docs/','/tests/','/renderer/src/','android'])if(files.some(file=>file.includes(forbidden)))throw new Error('Non-runtime source leaked into package: '+forbidden);
// 业务数据（单据/客户/改过的商品价格）绝不能进安装包
if(files.some(file=>/sd_v1_.*\.json$/.test(file)||file.includes('用户数据')))throw new Error('Business data leaked into the package');
for(const runtimeDir of ['用户数据','CommercesData','数据备份','送货单统计数据备份']){
  const target=path.join(folder,runtimeDir);
  if(fs.existsSync(target))throw new Error('Runtime data directory leaked into the package: '+runtimeDir);
}
const executable=path.join(folder,'送货宝.exe');
const profile=fs.mkdtempSync(path.join(os.tmpdir(),'dns-packaged-smoke-'));
const env={...process.env,DNS_SMOKE_USER_DATA:profile};delete env.ELECTRON_RUN_AS_NODE;
const smoke=spawnSync(executable,['--smoke','--enable-unsafe-swiftshader'],{env,encoding:'utf8',windowsHide:true,timeout:30000});
const log=(smoke.stdout||'')+(smoke.stderr||'');
fs.writeFileSync(path.join(output,'packaged-smoke.log'),log);
const resultFile=path.join(profile,'smoke-report.json');
let result=fs.existsSync(resultFile)?JSON.parse(fs.readFileSync(resultFile,'utf8')):null;
const nativeExecutableSmoke=smoke.status===0&&!!result?.allOk;
let archiveRuntimeSmoke=false;
if(!nativeExecutableSmoke){
  const archiveProfile=fs.mkdtempSync(path.join(os.tmpdir(),'dns-archive-smoke-'));
  const archiveEnv={...env,DNS_SMOKE_USER_DATA:archiveProfile};
  const archiveRun=spawnSync(require('electron'),[archive,'--smoke','--enable-unsafe-swiftshader'],{env:archiveEnv,encoding:'utf8',windowsHide:true,timeout:30000});
  const archiveResult=path.join(archiveProfile,'smoke-report.json');
  result=fs.existsSync(archiveResult)?JSON.parse(fs.readFileSync(archiveResult,'utf8')):null;
  archiveRuntimeSmoke=archiveRun.status===0&&!!result?.allOk;
  fs.writeFileSync(path.join(output,'archive-runtime-smoke.log'),(archiveRun.stdout||'')+(archiveRun.stderr||''));
  if(!archiveRuntimeSmoke)throw new Error('Archive runtime verification failed: '+JSON.stringify({status:archiveRun.status,error:archiveRun.error?.message,result,stdout:archiveRun.stdout,stderr:archiveRun.stderr}));
}
if(!result?.checks.some(([name,ok])=>name==='桌面场景工作台已就绪'&&ok))throw new Error('The desktop workspace was not loaded from the bundle');
const installer=path.join(releaseDir,'送货宝 Setup 1.0.0.exe');
// Verify the installer payload itself, not just the intermediate unpacked build.
const payload=fs.mkdtempSync(path.join(os.tmpdir(),'dns-installer-payload-'));
const extract=spawnSync(sevenZip,['x',installer,'-o'+payload,'-y'],{encoding:'utf8',windowsHide:true,timeout:60000});
if(extract.status!==0)throw new Error('Installer extraction failed: '+extract.stdout+extract.stderr);
for(const file of ['resources/app.asar','送货宝.exe'])if(!fs.readFileSync(path.join(payload,file)).equals(fs.readFileSync(path.join(folder,file))))throw new Error('Installer payload differs: '+file);
const payloadProfile=fs.mkdtempSync(path.join(os.tmpdir(),'dns-installer-native-'));
const payloadRun=spawnSync(path.join(payload,'送货宝.exe'),['--smoke','--enable-unsafe-swiftshader'],{cwd:payload,env:{...env,DNS_SMOKE_USER_DATA:payloadProfile},encoding:'utf8',windowsHide:true,timeout:30000});
const payloadReportPath=path.join(payloadProfile,'smoke-report.json');
const payloadReport=fs.existsSync(payloadReportPath)?JSON.parse(fs.readFileSync(payloadReportPath,'utf8')):null;
const extractedInstallerSmoke=payloadRun.status===0&&!!payloadReport?.allOk;
fs.writeFileSync(path.join(output,'installer-native-smoke.log'),(payloadRun.stdout||'')+(payloadRun.stderr||''));
if(!extractedInstallerSmoke)throw new Error('Extracted installer EXE failed: '+JSON.stringify({status:payloadRun.status,error:payloadRun.error?.message,result:payloadReport}));
const report={installer,bytes:fs.statSync(installer).size,sha256:crypto.createHash('sha256').update(fs.readFileSync(installer)).digest('hex'),verifiedFiles:checked.length,checked,nativeExecutableSmoke,nativeExitStatus:smoke.status,nativeError:smoke.error?.message||null,archiveRuntimeSmoke,extractedInstallerSmoke,installerPayloadMatches:true,smokeChecks:payloadReport.checks,profile,prototypeControllerExcluded:true};
fs.writeFileSync(path.join(output,'package-verification.json'),JSON.stringify(report,null,2));
console.log(payloadReport.checks.map(([name,ok])=>(ok?'PASS ':'FAIL ')+name).join('\n'));console.log(JSON.stringify({installer:report.installer,bytes:report.bytes,sha256:report.sha256,verifiedFiles:report.verifiedFiles,nativeExecutableSmoke,archiveRuntimeSmoke,extractedInstallerSmoke,installerPayloadMatches:true,prototypeControllerExcluded:true}));
