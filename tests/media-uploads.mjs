import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const {chromium} = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser=await chromium.launch({headless:true,channel:process.env.BROWSER_CHANNEL || 'msedge'});
const goodVideo={name:'clip.mp4',mimeType:'video/mp4',buffer:readFileSync('tests/fixtures/media-valid.mp4')};
const goodPhoto={name:'photo.jpg',mimeType:'image/jpeg',buffer:readFileSync('tests/fixtures/media-valid.jpg')};
const executable={name:'forged.mp4',mimeType:'video/mp4',buffer:Buffer.from('MZ not a video')};
const corrupt={name:'broken.jpg',mimeType:'image/jpeg',buffer:Buffer.from([255,216,255,0,0,0])};
let checks=0;const errors=[];
const check=(condition,label)=>{assert.ok(condition,label);console.log('PASS '+label);checks++};
async function setup(kind,mobile=false){
 const context=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1280,height:900},hasTouch:mobile});const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));const uploads=[],jobs=[];let tusOffset=0;
 await page.route(/^https:\/\/upload-test(?:\.storage)?\.supabase\.co\//,route=>{
  const req=route.request(),url=new URL(req.url());
  if(url.pathname.includes('/storage/v1/upload/resumable')){
   tusOffset+=req.postDataBuffer()?.length || 0;
   if(req.method()==='POST'){
    check((req.headers()['upload-metadata']||'').includes('bucketName '+Buffer.from('media-staging').toString('base64')),'resumable upload targets private staging');
    uploads.push('resumable/source');
    return route.fulfill({status:201,headers:{'Access-Control-Allow-Origin':'*','Access-Control-Expose-Headers':'Location,Upload-Offset,Tus-Resumable',Location:'https://upload-test.supabase.co/storage/v1/upload/resumable/fixture','Tus-Resumable':'1.0.0','Upload-Offset':String(tusOffset)}});
   }
   return route.fulfill({status:204,headers:{'Access-Control-Allow-Origin':'*','Access-Control-Expose-Headers':'Location,Upload-Offset,Tus-Resumable','Tus-Resumable':'1.0.0','Upload-Offset':String(tusOffset)}});
  }
  if(url.pathname.includes('/storage/v1/object/media-staging/')){uploads.push(url.pathname);return route.fulfill({json:{Key:url.pathname}})}
  if(url.pathname.endsWith('/queue-media-upload')){jobs.push(req.postDataJSON());return route.fulfill({status:202,json:{status:'queued'}})}
  if(url.pathname.includes('/rest/v1/media_upload_jobs')){const job=jobs.find(j=>'eq.'+j.id===url.searchParams.get('id'));return route.fulfill({json:job?.file_name==='server-reject'?{status:'error',error:'The file is corrupted or unsupported.'}:{status:'complete',result:{id:'fixture'}}});}
  return route.fulfill({json:[]});
 });
 await page.goto((process.env.TEST_BASE_URL || 'http://127.0.0.1:5189')+'/tests/media-upload.html?kind='+kind);await page.getByRole('button',{name:'Open Upload'}).waitFor();return {page,context,uploads,jobs};
}
async function drop(page,selector,files){
 const data=files.map(f=>({name:f.name,type:f.mimeType,bytes:[...f.buffer]}));
 await page.locator(selector).evaluate((el,files)=>{const transfer=new DataTransfer();for(const f of files)transfer.items.add(new File([new Uint8Array(f.bytes)],f.name,{type:f.type}));el.dispatchEvent(new DragEvent('dragover',{bubbles:true,cancelable:true,dataTransfer:transfer}));el.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:transfer}));},data);
}
try{
 if(!process.env.TEST_TUS_ONLY) for(const kind of ['video','photo']){
  const good=kind==='video'?goodVideo:goodPhoto,bad=kind==='video'?goodPhoto:goodVideo,broken=kind==='video'?executable:corrupt;
  for(const method of ['picker-single','picker-mixed','drop-single','drop-mixed','modal-drop']){
   const{page,context,uploads,jobs}=await setup(kind,method==='drop-mixed');
   const mixed=method.includes('mixed'),files=mixed?[good,bad,broken,{...good,name:'second.'+(kind==='video'?'mp4':'jpg')}]:[good];
   if(method.startsWith('picker')||method==='modal-drop'){
    await page.getByRole('button',{name:'Open Upload'}).click();const input=page.locator('input[type=file]').first();
    check((await input.getAttribute('accept')).includes(kind==='video'?'.mkv':'.heic'),kind+' picker filters '+method);
    if(method==='modal-drop') await drop(page,'[role=dialog] [class*="border-dashed"]',files);
    else await input.setInputFiles(files);
    if(method==='picker-single') await page.locator('button[type=submit]').click();
   }else await drop(page,'[data-testid=drop]',files);
   if(method!=='picker-single')await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(b=>b.textContent==='Done'&&!b.disabled),null,{timeout:20000});else await page.locator('[role=dialog]').waitFor({state:'detached',timeout:20000});
   // Only source transfers count; a single video may also have an automatic preview.
   check(uploads.filter(p=>p.endsWith('/source')).length===(mixed?2:1),kind+' '+method+' transfers valid files only');
   check(jobs.length===(mixed?2:1),kind+' '+method+' queues each valid file once');
   if(mixed)check((await page.locator('[role=dialog]').innerText()).includes('2 failed'),kind+' mixed summary contains independent failures');
   check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),kind+' '+method+' no horizontal overflow');
   await context.close();
  }
  {
   const{page,context,jobs}=await setup(kind);
   await drop(page,'[data-testid=drop]',[{...good,name:'server-reject.'+(kind==='video'?'mp4':'jpg')},good]);
   await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(b=>b.textContent==='Done'&&!b.disabled),null,{timeout:20000});
   check(jobs.length===2,kind+' server rejection does not interrupt another file');
   check((await page.locator('[role=dialog]').innerText()).includes('1 failed'),kind+' server failure displayed');
   check(await page.getByTestId('completed').textContent()==='1',kind+' only successful item refreshes gallery');
   await context.close();
  }
  for(const invalid of [bad,broken,{...bad,name:kind==='video'?'disguised.mp4':'disguised.jpg',mimeType:kind==='video'?'video/mp4':'image/jpeg'}]){
   const{page,context,uploads}=await setup(kind);await page.getByRole('button',{name:'Open Upload'}).click();await page.locator('input[type=file]').first().setInputFiles(invalid);
   if(invalid!==bad)await page.locator('button[type=submit]').click();
   await page.getByText(/cannot be uploaded here|cannot be decoded/).first().waitFor();
   check(uploads.length===0,kind+' invalid single-file rejected before transfer: '+invalid.name);await context.close();
  }
 }
 {
  const{page,context,jobs}=await setup('video');await page.getByRole('button',{name:'Open Upload'}).click();
  await page.locator('input[type=file]').first().evaluate((input,bytes)=>{
   const large=new Uint8Array(51*1024*1024);large.set(bytes);
   const transfer=new DataTransfer();transfer.items.add(new File([large],'large.mp4',{type:'video/mp4'}));transfer.items.add(new File([new Uint8Array(bytes)],'clip.mp4',{type:'video/mp4'}));
   input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));
  },[...goodVideo.buffer]);
  await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(b=>b.textContent==='Done'&&!b.disabled),null,{timeout:45000});
  check(jobs.length===2,'resumable and ordinary uploads use the same validation queue: '+await page.locator('[role=dialog]').innerText());await context.close();
 }
 check(errors.length===0,'no browser runtime errors: '+errors.join('; '));console.log(checks+' browser checks passed');
}finally{await browser.close()}




