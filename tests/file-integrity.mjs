// Mocked APIs only: never creates/deletes production records or storage.
import assert from 'node:assert/strict';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser=await chromium.launch({headless:true,channel:process.env.BROWSER_CHANNEL || 'msedge'});
const base=process.env.TEST_BASE_URL || 'http://127.0.0.1:5209';
assert.ok(/^http:\/\/127\.0\.0\.1:\d+$/.test(base),'Local isolated test server required');
const owner='11111111-1111-4111-8111-111111111111';
let checks=0;
function pass(label){checks++;console.log('PASS '+label)}
try {
 for(const width of [1440,768,390]) {
  const context=await browser.newContext({viewport:{width,height:900},hasTouch:width<1024});
  const page=await context.newPage(),objects=new Map(),errors=[];
  let deletes=0,failMetadata=false;
  const now=new Date().toISOString();
  const metadata=()=>[...objects.keys()].map(path=>({owner_id:owner,object_path:path,is_folder:false,is_favorite:false,file_size:7,mime_type:'text/plain',trashed_at:null,created_at:now,updated_at:now}));
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('https://upload-test.supabase.co/**',async route=>{
   const request=route.request(),url=new URL(request.url());
   if(url.pathname.includes('/storage/v1/object/user-files/')) {
    const path=decodeURIComponent(url.pathname.split('/user-files/')[1]);
    if(request.method()==='DELETE'){deletes++;return route.fulfill({json:[]})}
    if(path.endsWith('fail.txt')) return route.fulfill({status:500,json:{message:'Fixture write failed'}});
    objects.set(path,true);return route.fulfill({json:{Key:path}});
   }
   if(url.pathname.endsWith('/storage/v1/object/list/user-files')) return route.fulfill({json:[...objects.keys()].map((path,index)=>({id:String(index+1),name:path.split('/').at(-1),updated_at:now,created_at:now,metadata:{size:7,mimetype:'text/plain'}}))});
   if(url.pathname.endsWith('/rpc/file_manager_metadata')) {
    if(failMetadata){failMetadata=false;return route.fulfill({status:503,json:{message:'Fixture metadata response lost'}})}
    return route.fulfill({json:metadata()});
   }
   if(url.pathname.endsWith('/rpc/file_manager_storage_bytes')) return route.fulfill({json:objects.size*7});
   if(url.pathname.includes('/rest/v1/user_file_metadata')) return route.fulfill({json:metadata()});
   return route.fulfill({json:[]});
  });
  await page.goto(base+'/tests/file-integrity.html');
  await page.getByText('This folder is empty',{exact:true}).waitFor();
  const files=[{name:'first.txt',mimeType:'text/plain',buffer:Buffer.from('fixture')},{name:'fail.txt',mimeType:'text/plain',buffer:Buffer.from('fixture')},{name:'last.txt',mimeType:'text/plain',buffer:Buffer.from('fixture')}];
  await page.locator('input[type=file]').first().setInputFiles(files);
  const dialog=page.getByRole('dialog',{name:'Upload files'});
  await dialog.getByRole('button',{name:'Done',exact:true}).waitFor();
  assert.equal(objects.size,2);assert.equal(deletes,0);
  assert.ok((await dialog.innerText()).includes('Failed:'));
  await dialog.getByRole('button',{name:'Done',exact:true}).click();
  assert.equal(await page.locator('.fm-card').count(),2);
  pass(width+'px: batch file picker continues after failure and refreshes cards');
  failMetadata=true;
  await page.locator('.fm-drop-area').evaluate(element=>{
   const transfer=new DataTransfer();transfer.items.add(new File(['fixture'],'drop.txt',{type:'text/plain'}));
   element.dispatchEvent(new DragEvent('dragover',{bubbles:true,cancelable:true,dataTransfer:transfer}));
   element.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:transfer}));
  });
  await dialog.getByRole('button',{name:'Done',exact:true}).waitFor();
  assert.ok(objects.has(owner+'/drop.txt'));assert.equal(deletes,0);
  await dialog.getByRole('button',{name:'Done',exact:true}).click();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  assert.deepEqual(errors,[]);
  pass(width+'px: dropped saved file survives lost metadata response; no rollback deletion or overflow');
  await context.close();
 }
 console.log(checks+' File Manager browser checks passed');
}finally{await browser.close()}
