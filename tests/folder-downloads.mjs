import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import ts from 'typescript';
let source = await fs.readFile(new URL('../src/lib/folderDownloads.ts', import.meta.url), 'utf8');
source = source.replace(/^import .*;\r?\n/gm, '');
const javascript = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const make = (path, folder=false) => ({ path, name: path.split('/').pop(), isFolder: folder, mimeType: '', size: 0, updatedAt: '', favorite: false, trashedAt: null });
const loadFileChildren = async path => ({ entries: path === 'owner/Root' ? [make('owner/Root/Empty',true),make('owner/Root/Deep',true),make('owner/Root/café.txt')] : path === 'owner/Root/Deep' ? [make('owner/Root/Deep/payload.txt')] : [], hasMore: false });
let downloads = 0;
const exports = {};
new Function('exports','loadFileChildren','downloadFile',javascript)(exports,loadFileChildren,async entry => { downloads++; return { data: new Blob([entry.name === 'café.txt' ? 'unicode payload' : 'nested payload']), error: null }; });
const archive = await exports.downloadFolderArchive(make('owner/Root',true),'owner');
const result = spawnSync(process.env.PYTHON_BIN || 'python', ['-c', `import io,json,sys,zipfile
with zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read())) as archive:
 assert archive.testzip() is None
 assert archive.read('Root/café.txt')==b'unicode payload'
 assert archive.read('Root/Deep/payload.txt')==b'nested payload'
 assert 'Root/Empty/' in archive.namelist()
 print(json.dumps(archive.namelist()))`], { input: Buffer.from(await archive.arrayBuffer()), encoding:'utf8' });
assert.equal(result.status,0,result.stderr || result.error?.message);
assert.equal(downloads,2);
console.log('PASS folder ZIP opens in standard unzip reader with empty folders, nested payloads, Unicode names and valid checksums');
