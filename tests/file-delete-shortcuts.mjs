// Real FileManager + PostgreSQL permissions/catalog + actual deletion Edge handler.
// Synthetic local files only. No production mutations.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import ts from 'typescript';
import {PGlite} from '@electric-sql/pglite';
import * as engines from 'playwright';
import {createServer} from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import {setupFileStorageFixture} from './file-storage-fixture.mjs';
const owner='11111111-1111-4111-8111-111111111111';
const other='33333333-3333-4333-8333-333333333333';
const engine=process.env.BROWSER_ENGINE||'chromium';
const browser=await engines[engine].launch({headless:true,...(process.env.BROWSER_CHANNEL?{channel:process.env.BROWSER_CHANNEL}:{})});
const server=await createServer({configFile:false,root:process.cwd(),plugins:[react()],resolve:{alias:{'@':path.resolve('src')}},define:{'import.meta.env.VITE_SUPABASE_URL':JSON.stringify('https://upload-test.supabase.co'),'import.meta.env.VITE_SUPABASE_ANON_KEY':JSON.stringify('fixture')},server:{host:'127.0.0.1',port:0}});
const source=(await fs.readFile('supabase/functions/delete-user-file/index.ts','utf8')).replace(/^import .*;\r?\n/gm,'');
const edgeCode=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
await server.listen();
try{
for(const width of [1440,390]){
 const db=new PGlite();let handler;const events=[],errors=[];let actor=owner,failPath='',holdRemoval;
 const sql=(statement,args=[])=>db.query(statement,args).then(r=>r.rows);
 const service=async callback=>db.transaction(async tx=>{await tx.exec('SET LOCAL ROLE service_role');return callback(tx);});
 const rows=async(statement,args=[])=>db.transaction(async tx=>{await tx.exec(`SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claim.sub='${actor}'`);return (await tx.query(statement,args)).rows;});
 const result=async callback=>{try{return {data:await callback(),error:null};}catch(e){return {data:null,error:{code:e.code,message:e.message}};}};
 const client={auth:{getUser:async token=>({data:{user:token==='fixture'?{id:actor}:null},error:null})},
  rpc:(name,args)=>{
   if(name==='user_file_deletion_objects')return {limit:()=>result(()=>service(tx=>tx.query('SELECT * FROM user_file_deletion_objects($1,$2)',[args.p_id,args.p_owner]).then(r=>r.rows)))};
   if(name==='begin_user_file_deletion')return result(()=>service(tx=>tx.query('SELECT begin_user_file_deletion($1,$2,$3,$4) id',[args.p_owner,args.p_path,args.p_trashed_at,args.p_folder]).then(r=>r.rows[0].id)));
   if(name==='finish_user_file_deletion')return result(()=>service(tx=>tx.query('SELECT finish_user_file_deletion($1,$2)',[args.p_id,args.p_owner]).then(()=>null)));
   throw Error('Unexpected service RPC '+name);
  },storage:{from:bucket=>({remove:async paths=>{
   events.push({kind:'remove',paths:[...paths]});
   if(holdRemoval){await holdRemoval;holdRemoval=null;}
   if(paths.some(p=>p===failPath)){failPath='';return {error:new Error('Injected storage failure')};}
   return result(()=>service(tx=>tx.query('DELETE FROM storage.objects WHERE bucket_id=$1 AND name=ANY($2::text[]) RETURNING name',[bucket,paths]).then(r=>r.rows)));
  }})}};
 new Function('Deno','createClient',edgeCode)({env:{get:()=>''},serve:h=>{handler=h;}},()=>client);
 await setupFileStorageFixture(db);
 await sql('INSERT INTO auth.users VALUES($1),($2)',[owner,other]);
 await sql("INSERT INTO profiles VALUES($1,'fixture@test.invalid'),($2,'other@test.invalid')",[owner,other]);
 assert.equal((await handler(new Request('https://fixture.test/delete-user-file',{method:'POST',body:'{}'}))).status,401);
 assert.equal((await handler(new Request('https://fixture.test/delete-user-file',{method:'POST',headers:{Authorization:'Bearer fixture'},body:JSON.stringify({path:other+'/foreign.txt',is_folder:false,trashed_at:new Date().toISOString()})}))).status,400);
 const seed=async name=>sql("INSERT INTO storage.objects(bucket_id,name) VALUES('user-files',$1)",[owner+'/'+name]);
 for(const name of ['ordinary.txt','keyboard.txt','menu.txt','bulk-a.txt','bulk-b.txt','Folder/.folder','Folder/child.txt','retry.txt','pending.txt'])await seed(name);
 const context=await browser.newContext({viewport:{width,height:900},hasTouch:width<600});const page=await context.newPage();page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));
 await page.route('https://upload-test.supabase.co/**',async route=>{
  const request=route.request(),url=new URL(request.url()),body=request.postData()?request.postDataJSON():{},rpc=url.pathname.split('/rpc/')[1];
  try{
   if(url.pathname.endsWith('/functions/v1/delete-user-file')){
    events.push({kind:'permanent',...body});
    const response=await handler(new Request(request.url(),{method:'POST',headers:request.headers(),body:request.postData()}));
    return route.fulfill({status:response.status,body:await response.text(),headers:Object.fromEntries(response.headers)});
   }
   if(rpc){const args={file_manager_metadata:[body.p_folder??'',body.p_view??'files',body.p_offset??0],file_manager_storage_bytes:[],file_manager_objects:[body.p_folder,body.p_limit,body.p_offset],unfinished_file_operations:[]}[rpc];
    if(!args)return route.fulfill({json:[]});
    const call=`public.${rpc}(${args.map((_,i)=>'$'+(i+1)).join(',')})`;
    const data=await rows(['file_manager_metadata','file_manager_objects'].includes(rpc)?'SELECT * FROM '+call:'SELECT '+call+' value',args);
    return route.fulfill({json:['file_manager_metadata','file_manager_objects'].includes(rpc)?data:rpc==='unfinished_file_operations'?data.map(r=>r.value):data[0]?.value});
   }
   if(url.pathname.includes('/rest/v1/user_file_metadata')){
    const args=[],conditions=[];
    for(const key of ['owner_id','object_path']){const filter=url.searchParams.get(key);if(!filter)continue;
     if(filter.startsWith('eq.')){args.push(filter.slice(3));conditions.push(key+'=$'+args.length);}
     else if(filter.startsWith('in.')){args.push((filter.slice(4,-1).match(/"(?:\\.|[^"])*"|[^,]+/g)||[]).map(x=>x.startsWith('"')?JSON.parse(x):x));conditions.push(key+'=ANY($'+args.length+'::text[])');}
     else if(filter.startsWith('like.')){args.push(filter.slice(5));conditions.push(key+' LIKE $'+args.length);}
    }
    const where=conditions.length?' WHERE '+conditions.join(' AND '):'';
    if(request.method()==='GET')return route.fulfill({json:await rows('SELECT * FROM user_file_metadata'+where+' ORDER BY object_path',args)});
    if(request.method()==='PATCH'){
     assert.ok(Object.keys(body).every(k=>['trashed_at','updated_at'].includes(k)));
     events.push({kind:'trash',paths:args.flat().filter(x=>typeof x==='string'&&x.startsWith(owner+'/')),timestamp:body.trashed_at});
     const set=Object.keys(body).map(key=>{args.push(body[key]);return key+'=$'+args.length;});
     await rows('UPDATE user_file_metadata SET '+set.join(',')+where,args);return route.fulfill({body:''});
    }
   }
   return route.fulfill({json:[]});
  }catch(e){errors.push(e.message);return route.fulfill({status:400,json:{message:e.message}});}
 });
 const card=name=>page.locator('.fm-card').filter({has:page.getByText(name,{exact:true})});
 const select=async name=>{await card(name).getByRole('button',{name:'Select',exact:true}).click();};
 const dialog=page.getByRole('alertdialog');const cancel=()=>dialog.getByRole('button',{name:'Cancel',exact:true}).click();
 const exists=async name=>(await sql('SELECT 1 FROM storage.objects WHERE name=$1',[owner+'/'+name])).length>0;
 const menu=page.getByRole('menu');
 const finished=()=>dialog.waitFor({state:'hidden'}).catch(async error=>{throw new Error(error.message+' '+JSON.stringify({errors,events,dialog:await dialog.innerText()}));});
 await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/tests/content-context.html#/files`);
 await card('ordinary.txt').waitFor();
 await select('ordinary.txt');await page.keyboard.press('Delete');
 await dialog.getByRole('heading',{name:'Move to Trash',exact:true}).waitFor();assert.equal(events.length,0);
 await page.keyboard.press('Escape');await page.mouse.click(1,1);assert.ok(await dialog.isVisible());await cancel();assert.equal(events.length,0);
 await page.keyboard.press('Shift+Delete');await dialog.getByRole('heading',{name:'Permanently delete items',exact:true}).waitFor();assert.match(await dialog.innerText(),/ordinary.txt/);assert.match(await dialog.innerText(),/cannot be undone/);await cancel();assert.equal(events.length,0);
 // Text editing must never invoke file deletion.
 await page.getByPlaceholder('Search files and folders').focus();await page.keyboard.press('Shift+Delete');assert.equal(await dialog.count(),0);
 await page.getByRole('button',{name:'Switch user',exact:true}).focus();await page.keyboard.press('Shift+Delete');assert.equal(await dialog.count(),0);
 await card('ordinary.txt').getByRole('button',{name:'Deselect',exact:true}).click();await select('keyboard.txt');
 await page.keyboard.press('Shift+Delete');await dialog.getByRole('button',{name:'Delete forever',exact:true}).click();await finished();
 assert.equal(await exists('keyboard.txt'),false);assert.deepEqual(events.slice(0,3).map(e=>e.kind),['trash','permanent','remove']);
 // Shift while a menu is open changes the command and captures its modifier.
 await page.getByRole('button',{name:'Actions for menu.txt',exact:true}).click();await page.keyboard.down('Shift');
 await menu.getByRole('menuitem',{name:'Delete forever',exact:true}).waitFor();await menu.getByRole('menuitem',{name:'Delete forever',exact:true}).click();await page.keyboard.up('Shift');
 await dialog.getByRole('heading',{name:'Permanently delete items',exact:true}).waitFor();await cancel();assert.equal(await exists('menu.txt'),true);
 await page.getByRole('button',{name:'Actions for menu.txt',exact:true}).click();await menu.getByRole('menuitem',{name:'Move to Trash',exact:true}).click({modifiers:['Shift']});await dialog.getByRole('button',{name:'Delete forever',exact:true}).click();await finished();assert.equal(await exists('menu.txt'),false);
 await select('bulk-a.txt');await select('bulk-b.txt');failPath=owner+'/bulk-b.txt';
 await page.getByRole('button',{name:'Delete',exact:true}).click({modifiers:['Shift']});assert.match(await dialog.innerText(),/2 selected items/);
 await dialog.getByRole('button',{name:'Delete forever',exact:true}).click();await dialog.getByRole('alert').waitFor();
 assert.equal(await exists('bulk-a.txt'),false);assert.equal(await exists('bulk-b.txt'),true);
 const failedTimestamp=events.filter(e=>e.kind==='permanent'&&e.path.endsWith('bulk-b.txt'))[0].trashed_at;
 const firstCalls=events.filter(e=>e.kind==='permanent'&&e.path.endsWith('bulk-a.txt')).length;
 await dialog.getByRole('button',{name:'Delete forever',exact:true}).click();await finished();
 assert.equal(await exists('bulk-b.txt'),false);assert.equal(events.filter(e=>e.kind==='permanent'&&e.path.endsWith('bulk-a.txt')).length,firstCalls);
 assert.ok(events.filter(e=>e.kind==='permanent'&&e.path.endsWith('bulk-b.txt')).every(e=>e.trashed_at===failedTimestamp));
 await select('Folder');await page.keyboard.press('Shift+Delete');assert.match(await dialog.innerText(),/All of their contents/);await dialog.getByRole('button',{name:'Delete forever',exact:true}).click();await finished();assert.equal(await exists('Folder/child.txt'),false);
 await select('ordinary.txt');await page.keyboard.press('Delete');await dialog.getByRole('button',{name:'Move to Trash',exact:true}).click();await finished();assert.equal(await exists('ordinary.txt'),true);assert.ok((await sql('SELECT trashed_at FROM user_file_metadata WHERE object_path=$1',[owner+'/ordinary.txt']))[0].trashed_at);
 await select('pending.txt');let release;holdRemoval=new Promise(r=>{release=r;});await page.keyboard.press('Shift+Delete');await dialog.getByRole('button',{name:'Delete forever',exact:true}).dblclick();await dialog.getByRole('button',{name:'Deleting…',exact:true}).waitFor();assert.equal(await dialog.getByRole('button',{name:'Cancel',exact:true}).isDisabled(),true);release();await finished();assert.equal(events.filter(e=>e.kind==='permanent'&&e.path.endsWith('pending.txt')).length,1);
 actor=other;await page.getByRole('button',{name:'Switch user',exact:true}).click();await page.getByText('This folder is empty',{exact:true}).waitFor();const before=events.length;await page.keyboard.press('Shift+Delete');assert.equal(events.length,before);assert.equal(await dialog.count(),0);
 assert.deepEqual(errors,[]);console.log(`PASS ${engine} ${width}px: ordinary Delete/Shift+Delete, Shift menu/bulk, Cancel/overlay/Escape, editable fields, folder contents, backend authorization, pending guard and partial retry identity`);
 await context.close();await db.close();
}
}finally{await browser.close();await server.close();}
