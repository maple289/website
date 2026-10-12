import {spawn} from 'node:child_process';
import {writeFile} from 'node:fs/promises';
const suites=['messenger-call-layout','messenger-call-audio-ui','content-context','file-previews','settings-navigation','public-navigation'];
const results=[];
for(const name of suites) {
 const start=Date.now(),chunks=[];
 const child=spawn(process.execPath,['audit/20261011/'+name+'-diagnostic.mjs'],{env:{...process.env,TEST_BASE_URL:'http://127.0.0.1:5226'},stdio:['ignore','pipe','pipe']});
 child.stdout.on('data',d=>chunks.push(d.toString()));child.stderr.on('data',d=>chunks.push(d.toString()));
 const code=await new Promise(resolve=>child.on('exit',resolve));
 const lines=chunks.join('').split(/\r?\n/);
 const result={suite:name,exitCode:code,seconds:Math.round((Date.now()-start)/1000),passes:lines.filter(x=>x.startsWith('PASS ')||/^\d+ .*passed/.test(x)),failures:code?lines.filter(x=>x.length<300&&/Error|Timeout|waiting for|expected|actual|ERR_|Failed/.test(x)).slice(-12):[]};
 results.push(result);await writeFile('audit/20261011/browser-tests-corrected.json',JSON.stringify(results,null,2));
 console.log(JSON.stringify({suite:name,exitCode:code,seconds:result.seconds,passLines:result.passes.length,failures:result.failures}));
}
