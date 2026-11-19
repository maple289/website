// Real PDF.js, workers, FileManager and temporary-share UI; synthetic bytes only.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const engines = await import('playwright');
const engine = process.env.BROWSER_ENGINE || 'chromium';
const channel = engine === 'chromium' ? process.env.BROWSER_CHANNEL : undefined;
const browser = await engines[engine].launch({ headless: true, ...(channel ? { channel } : {}) });
console.log(`PDF browser: ${channel || engine} ${browser.version()}`);
const base = process.env.TEST_BASE_URL;
const connectPolicy=(await fs.readFile('docker/Caddyfile','utf8')).match(/connect-src [^;]+;/)[0];
const owner = '11111111-1111-4111-8111-111111111111';
const folder = '22222222-2222-4222-8222-222222222222';
function makePdf(count) {
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', `<< /Type /Pages /Kids [${Array.from({length:count}, (_,i)=>`${3+i*2} 0 R`).join(' ')}] /Count ${count} >>`];
  const font = 3 + count * 2;
  for (let i=0;i<count;i++) {
    const text = `BT /F1 24 Tf 50 700 Td (PDF test page ${i+1}) Tj ET`;
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${4+i*2} 0 R >>`, `<< /Length ${text.length} >>\nstream\n${text}\nendstream`);
  }
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  let pdf='%PDF-1.4\n'; const offsets=[];
  for(const [i,object] of objects.entries()) {offsets.push(Buffer.byteLength(pdf));pdf+=`${i+1} 0 obj\n${object}\nendobj\n`;}
  const xref=Buffer.byteLength(pdf);
  return Buffer.from(pdf+`xref\n0 ${objects.length+1}\n0000000000 65535 f \n`+offsets.map(n=>String(n).padStart(10,'0')+' 00000 n \n').join('')+`trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
}
const pdf=makePdf(12), large=makePdf(300);
const profiles = engine === 'webkit'
  ? [['iPhone Safari',390,844,true,'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1'],['iPhone Firefox',390,844,true,'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 FxiOS/134.0 Mobile/15E148 Safari/605.1.15']]
  : [['Desktop',1440,900,false],['Android',412,915,true]];
await fs.mkdir('.runtime/pdf-preview',{recursive:true});
try {
for (const [label,width,height,touch,userAgent] of profiles.filter(p=>!process.env.PDF_PROFILE || p[0]===process.env.PDF_PROFILE)) {
  const context = await browser.newContext({viewport:{width,height},hasTouch:touch,...(engine!=='firefox'?{isMobile:touch}:{}),...(userAgent?{userAgent}:{}),acceptDownloads:true});
  const page = await context.newPage(), errors=[], logs=[], requests=[];
  page.setDefaultTimeout(20000);
  page.on('pageerror',e=>errors.push(e.message));
  page.on('console',e=>{if(e.type()==='error') logs.push(e.text());});
  await page.addInitScript(()=>{
    window.__pdfCspViolations=[];
    document.addEventListener('securitypolicyviolation',event=>window.__pdfCspViolations.push({directive:event.violatedDirective,uri:event.blockedURI}));
  });
  const entries=['Manual.PDF','Large.pdf','MIME-only guide','Corrupt.pdf','Denied.pdf','Slow.pdf'].map((name,i)=>({id:`33333333-3333-4333-8333-${String(i).padStart(12,'0')}`,name,path:`${owner}/Documents/${name}`,isFolder:false,size:10000,mimeType:'application/pdf',updatedAt:new Date().toISOString(),favorite:false,trashedAt:null}));
  let expired=false;
  await page.route('https://preview-test.supabase.co/**',async route=>{
    const req=route.request(),url=new URL(req.url()),op=url.pathname.split('/').pop(),body=req.method()==='POST'?req.postDataJSON():{};
    requests.push(url.pathname);
    if(op==='temporary-share') {
      if(expired) return route.fulfill({status:410,json:{error:'This share link has expired.'}});
      return route.fulfill(url.searchParams.has('metadata')?{json:{type:'file',name:'Temporary.pdf',mime:'application/pdf'}}:{contentType:'application/pdf',body:pdf,headers:{'Content-Disposition':url.searchParams.has('download')?'attachment; filename="Temporary.pdf"':'inline'}});
    }
    if(op==='user_file_metadata') return route.fulfill({json:entries.map(e=>({object_path:e.path,is_folder:false,file_size:e.size,mime_type:e.mimeType,is_favorite:false,trashed_at:null,updated_at:e.updatedAt,created_at:e.updatedAt}))});
    if(op==='file_manager_objects') return route.fulfill({json:body.p_folder===owner?[{name:'Documents',id:null}]:entries.map(e=>({name:e.name,id:e.id,metadata:{size:e.size,mimetype:e.mimeType}}))});
    if(op==='resolve_user_file_location') return route.fulfill({json:{bucket:'user-files',path:body.p_path,id:null}});
    if(url.pathname.includes('/storage/v1/object/authenticated/') || op==='serve-public-file') return route.fulfill({body:pdf,contentType:'application/pdf'});
    if(op!=='file-preview') return route.fulfill({json:[]});
    const entry=entries.find(e=>e.path===url.searchParams.get('path')||e.id===url.searchParams.get('id'));
    assert.ok(entry);
    assert.match(req.headers().authorization,/Bearer /);
    if(entry.name==='Denied.pdf') return route.fulfill({status:404,json:{status:'failed',message:'secret-internal-storage-key'}});
    if(entry.name==='Slow.pdf'&&url.searchParams.has('content')) return; // closed/aborted by caller
    if(!url.searchParams.has('content')) return route.fulfill({json:{status:'available',kind:'pdf'}});
    return route.fulfill({contentType:'application/pdf',body:entry.name==='Large.pdf'?large:entry.name==='Corrupt.pdf'?Buffer.from('%PDF-1.7\ninvalid bytes'):pdf});
  });
  const dialog=page.getByRole('dialog',{name:'File preview'});
  const close=async()=>{await dialog.getByRole('button',{name:'Close preview',exact:true}).click();await dialog.waitFor({state:'detached'});assert.equal(await page.locator('[inert]').count(),0);};
  const open=async name=>{await page.getByText(name,{exact:true}).click();await dialog.waitFor();};
  const painted=async()=>{await dialog.locator('.page[data-loaded="true"] canvas').first().waitFor();await dialog.getByText('Rendering PDF…',{exact:true}).waitFor({state:'hidden'});};
  try {
    console.log(`CHECK ${label}: open and paint`);
    const documentResponse=await page.goto(base+'/tests/file-previews.html#/files');
    assert.equal(documentResponse.headers()['content-security-policy'],connectPolicy,'fixture must enforce the deployed connection policy');
    await page.getByText('Documents',{exact:true}).click();
    const folderUrl=page.url();
    await open('Manual.PDF'); await painted();
    assert.deepEqual(await page.evaluate(()=>window.__pdfCspViolations.filter(v=>v.directive==='connect-src')),[],'PDF rendering obeys production connect-src without Blob fetches');
    assert.equal(await dialog.locator('iframe,object,embed').count(),0);
    assert.ok(await dialog.locator('canvas').first().evaluate(c=>{const p=c.getContext('2d').getImageData(0,0,c.width,c.height).data;for(let i=0;i<p.length;i+=4)if(p[i+3]&&Math.min(p[i],p[i+1],p[i+2])<230)return true;return false;}));
    await dialog.getByRole('button',{name:'Next PDF page',exact:true}).click();
    await dialog.getByText('Page 2 / 12',{exact:true}).waitFor();
    const input=dialog.getByRole('spinbutton',{name:'Go to PDF page'});
    await input.fill('10'); await input.press('Enter');await dialog.getByText('Page 10 / 12',{exact:true}).waitFor();
    await dialog.locator('.fp-pdf-scroll').evaluate(el=>{el.scrollTop=0;el.dispatchEvent(new Event('scroll'));});
    await dialog.getByText('Page 1 / 12',{exact:true}).waitFor();
    const before=await dialog.getByLabel('PDF zoom',{exact:true}).innerText();
    await dialog.getByRole('button',{name:'Zoom in PDF',exact:true}).click();
    await page.waitForFunction(previous=>document.querySelector('[aria-label="PDF zoom"]').textContent!==previous,before);
    await dialog.getByRole('button',{name:'Zoom out PDF',exact:true}).click();
    if(touch) {
      const zoom=await dialog.getByLabel('PDF zoom',{exact:true}).innerText();
      await dialog.locator('.fp-pdf-scroll').evaluate(el=>{
        for(const [type,points] of [['touchstart',[[80,180],[180,180]]],['touchmove',[[50,180],[210,180]]],['touchend',[]]]){const event=new Event(type,{bubbles:true,cancelable:true});Object.defineProperty(event,'touches',{value:points.map(([clientX,clientY])=>({clientX,clientY}))});el.dispatchEvent(event);}
      });
      await page.waitForFunction(previous=>document.querySelector('[aria-label="PDF zoom"]').textContent!==previous,zoom);
    }
    await dialog.getByRole('button',{name:'Fit PDF to width',exact:true}).click();
    console.log(`CHECK ${label}: fullscreen and download`);
    const ratio=await dialog.locator('.page').first().evaluate(e=>e.getBoundingClientRect().width/e.getBoundingClientRect().height);
    assert.ok(Math.abs(ratio-612/792)<0.02);
    if(touch) await page.evaluate(()=>Object.defineProperty(document,'fullscreenEnabled',{value:false,configurable:true}));
    await dialog.getByRole('button',{name:'Enter PDF fullscreen',exact:true}).click();
    await dialog.locator('[data-pdf-fullscreen="true"]').waitFor();
    await dialog.getByRole('button',{name:'Exit PDF fullscreen',exact:true}).click();
    await dialog.locator('[data-pdf-fullscreen="true"]').waitFor({state:'detached'});
    if(touch) await page.evaluate(()=>delete document.fullscreenEnabled);
    const downloaded=page.waitForEvent('download');await dialog.getByRole('button',{name:'Download original file',exact:true}).click();
    assert.match((await downloaded).suggestedFilename(),/Manual\.PDF$/i);
    await page.mouse.click(1,1);await page.keyboard.press('Escape');assert.ok(await dialog.isVisible());
    if(touch) {
      await page.setViewportSize({width:844,height:390});
      await page.evaluate(()=>{
        Object.defineProperties(visualViewport,{height:{configurable:true,get:()=>innerHeight-88},offsetTop:{configurable:true,get:()=>44}});
        visualViewport.dispatchEvent(new Event('resize'));
      });
    }
    await page.waitForTimeout(300);
    assert.ok(await dialog.getByRole('button',{name:'Close preview',exact:true}).evaluate(e=>{const r=e.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight&&r.right<=innerWidth;}));
    assert.ok(await dialog.locator('.fp-pdf-scroll').evaluate(e=>e.clientHeight>80&&e.scrollHeight>e.clientHeight));
    if(touch) assert.ok(await dialog.getByRole('button',{name:'Close preview',exact:true}).evaluate(e=>{const r=e.getBoundingClientRect();return r.top>=44&&r.bottom<=innerHeight-44;}),'Close respects the visible viewport when browser toolbars occupy space');
    await dialog.locator('.fp-pdf-scroll').evaluate(el=>{el.scrollTop=0;el.dispatchEvent(new Event('scroll'));});
    await page.waitForFunction(()=>{
      const c=document.querySelector('.page[data-page-number="1"] canvas');
      if(!c||getComputedStyle(c).visibility==='hidden'||c.getBoundingClientRect().height===0)return false;
      const p=c.getContext('2d').getImageData(0,0,c.width,c.height).data;
      for(let i=0;i<p.length;i+=4)if(p[i+3]&&Math.min(p[i],p[i+1],p[i+2])<230)return true;
      return false;
    });
    await page.screenshot({path:`.runtime/pdf-preview/${engine}-${label.replaceAll(' ','-')}.png`});
    await close(); assert.equal(page.url(),folderUrl);
    console.log(`CHECK ${label}: large PDF and navigation`);
    if(touch) {
      await page.evaluate(()=>{delete visualViewport.height;delete visualViewport.offsetTop;visualViewport.dispatchEvent(new Event('resize'));});
      await page.setViewportSize({width,height});
    }
    await open('Large.pdf');await painted();
    await dialog.getByText('Page 1 / 300',{exact:true}).waitFor();
    assert.ok(await dialog.locator('canvas').count()<20,'300-page PDF only renders nearby pages');
    await input.fill('290');await input.press('Enter');await dialog.getByText('Page 290 / 300',{exact:true}).waitFor();
    await dialog.locator('.page[data-page-number="290"][data-loaded="true"] canvas').first().waitFor();
    assert.ok(await dialog.locator('canvas').count()<20,'distant page navigation evicts earlier canvases');
    assert.ok(await dialog.locator('canvas').evaluateAll(cs=>cs.every(c=>c.width*c.height<=2097152+8192)),'bounded page canvas resolution');
    await close();
    await open('MIME-only guide');await painted();await close();
    await open('Manual.PDF');await painted();await page.goBack();
    await dialog.waitFor({state:'detached'});assert.equal(await page.locator('[inert]').count(),0);
    await page.getByText('Documents',{exact:true}).click();
    console.log(`CHECK ${label}: corrupt and denied PDFs`);
    for(const name of ['Corrupt.pdf','Denied.pdf']) {
      await open(name);await dialog.getByRole('heading',{name:'Preview unavailable',exact:true}).waitFor();
      assert.equal((await dialog.innerText()).includes('secret-internal-storage-key'),false);
      await dialog.getByRole('button',{name:'Download PDF',exact:true}).waitFor();await close();
    }
    await open('Slow.pdf');await dialog.getByText('Loading preview…',{exact:true}).waitFor();await close();
    const prior=requests.length;
    console.log(`CHECK ${label}: temporary share`);
    await page.goto(base+'/tests/temporary-share.html');await painted();
    assert.ok(requests.slice(prior).every(p=>p.endsWith('/temporary-share')),'capability viewer uses only temporary-share endpoint');
    await close();expired=true;await page.getByRole('button',{name:'Open PDF',exact:true}).click();
    await dialog.getByRole('heading',{name:'Preview unavailable',exact:true}).waitFor();await close();
    assert.deepEqual(errors,[]);
    if(!touch) {
      console.log(`CHECK ${label}: stalled source and missing module`);
      // Accelerate only the fetch deadline. Context-wide virtual clocks can
      // stall while installing into Edge's back/forward cached documents.
      await page.addInitScript(()=>{
        const original=window.setTimeout.bind(window);
        window.setTimeout=(callback,delay,...args)=>original(callback,delay===60000?2000:delay,...args);
      });
      await page.goto(base+'/tests/file-previews.html#/files');await page.getByText('Documents',{exact:true}).click();
      const slow=page.waitForRequest(r=>r.url().includes('/file-preview?')&&r.url().includes('Slow.pdf')&&r.url().includes('content=1'));
      await open('Slow.pdf');await slow;
      await dialog.getByRole('heading',{name:'Preview unavailable',exact:true}).waitFor();await close();
      await page.route('**/src/components/PdfFilePreview.tsx',route=>route.abort());
      await page.goto(base+'/tests/file-previews.html#/files');await page.getByText('Documents',{exact:true}).click();
      await open('Manual.PDF');await dialog.getByRole('heading',{name:'Preview unavailable',exact:true}).waitFor();await close();
    }
    console.log(`PASS ${engine} ${label}: 12/300-page rendering, MIME fallback, scroll/navigation/zoom/pinch, fullscreen, download, close, rotation, failure and temporary expiry`);
  } catch(error) {console.error({engine,label,errors,logs,body:await page.locator('body').innerText()});await page.screenshot({path:`.runtime/pdf-preview/${engine}-failed.png`});throw error;}
  finally {await context.close();}
}
} finally {await browser.close();}
