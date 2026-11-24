// Real gallery player and decoded frame comparisons; no production traffic.
import assert from 'node:assert/strict';
import * as engines from 'playwright';
import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs/promises';
import { createPublicPreviewServer } from './public-previews-server.mjs';
const require=createRequire(import.meta.url);
const {PNG}=require(path.join(path.dirname(require.resolve('playwright-core/package.json')),'lib/utilsBundle.js'));
const engine=process.env.BROWSER_ENGINE||'chromium';
const server=await createPublicPreviewServer();await server.listen();
const browser=await engines[engine].launch({headless:true,...(process.env.BROWSER_CHANNEL?{channel:process.env.BROWSER_CHANNEL}:{})});
const frameComparisonStyle='.video-player-header,.video-presentation-controls,.reaction-bar,.reaction-details{opacity:0!important;transition:none!important;}';
async function completeFrame(page, label) {
  // Compare the rendered playback area against the SAME decoded video frame,
  // drawn uncropped with uniform scaling. Hide controls/overlays for pixel
  // comparison, then restore them for UI captures and interaction checks.
  const captureStyle = await page.addStyleTag({ content: '.managed-video[data-layout-frame-capture]::-webkit-media-controls { display: none !important; }' });
  const source = await page.locator('video').evaluate(async v => {
    // WebKit's media-controls compositor can outlive the controls attribute
    // change, especially immediately after fullscreen/PiP and rotation. Hide
    // the native chrome explicitly for this frame-only comparison and wait for
    // the new geometry to paint. Restore everything before interaction checks.
    v.pause();
    v.controls = false;
    v.setAttribute('data-layout-frame-capture', '');
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const area = v.parentElement.getBoundingClientRect();
    const canvas = document.createElement('canvas');
    // Element screenshots cover enclosing device pixels; Firefox can return
    // fractional CSS edges, including two partially covered boundary pixels.
    canvas.width = Math.ceil(area.right) - Math.floor(area.left);
    canvas.height = Math.ceil(area.bottom) - Math.floor(area.top);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = 'black'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    const scale = Math.min(area.width / v.videoWidth, area.height / v.videoHeight);
    const width = v.videoWidth * scale, height = v.videoHeight * scale;
    const left=area.left-Math.floor(area.left)+(area.width-width)/2;
    const top=area.top-Math.floor(area.top)+(area.height-height)/2;
    ctx.drawImage(v,left,top,width,height);
    return {png:canvas.toDataURL('image/png').split(',')[1],frame:{left,top,width,height}};
  });
  try {
    // A portal popover can remain over the media after a previous reaction tap
    // or hover. Visibility transitions can also keep a bar painted after its
    // inline visibility changes. Isolate ALL application overlays for this
    // screenshot only; opacity preserves popup focus/hover state, and Playwright
    // restores the stylesheet immediately after.
    const actualBuffer = await page.locator('.video-playback-area').screenshot({ style: frameComparisonStyle });
    const expected = PNG.sync.read(Buffer.from(source.png, 'base64'));
    const actual = PNG.sync.read(actualBuffer);
    assert.ok(Math.abs(actual.width - expected.width) <= 1 && Math.abs(actual.height - expected.height) <= 1, `capture rounding is at most one pixel: ${label} ${JSON.stringify({actual:[actual.width,actual.height],expected:[expected.width,expected.height],geometry:await geometry(page)})}`);
    if(!label.includes('fullscreen')) {
      const corners={red:(r,g,b)=>r>200&&g<100&&b<100,green:(r,g,b)=>g>170&&r<130&&b<140,
        blue:(r,g,b)=>b>170&&r<130&&g<150,yellow:(r,g,b)=>r>180&&g>170&&b<140};
      const bounds=(png,match,name)=>{let left=Infinity,top=Infinity,right=-1,bottom=-1,count=0;
        const f=source.frame,leftSide=name==='red'||name==='blue',topSide=name==='red'||name==='green';
        for(let y=0;y<png.height;y++)for(let x=0;x<png.width;x++){
          if((leftSide?x>f.left+f.width*.25:x<f.left+f.width*.75)||(topSide?y>f.top+f.height*.25:y<f.top+f.height*.75))continue;
          const i=(y*png.width+x)*4;if(match(png.data[i],png.data[i+1],png.data[i+2])){left=Math.min(left,x);top=Math.min(top,y);right=Math.max(right,x);bottom=Math.max(bottom,y);count++;}}
        return {left,top,right,bottom,count};};
      for(const [name,match] of Object.entries(corners)){
        const a=bounds(actual,match,name),b=bounds(expected,match,name);
        assert.ok(b.count>0&&a.count>=b.count*.5,`${label}: full ${name} corner marker visible`);
        for(const edge of ['left','top','right','bottom'])assert.ok(Math.abs(a[edge]-b[edge])<=2,`${label}: ${name} corner ${edge} aligned within compositor rounding ${JSON.stringify({actual:a,expected:b})}`);
      }
    }
    // Tolerate decoder/compositor rounding, but detect lost edges and incorrect
    // contain scaling. Compare the whole image, including its outer strips.
    const regions = { all: [0, 0], picture: [0, 0], top: [0, 0], bottom: [0, 0], left: [0, 0], right: [0, 0] };
    for (let y = 1; y < Math.min(actual.height, expected.height) - 1; y++) for (let x = 1; x < Math.min(actual.width, expected.width) - 1; x++) {
      const i = (y * actual.width + x) * 4;
      const j = (y * expected.width + x) * 4;
      // The video compositor and canvas use different downsampling filters.
      // Compare local 3x3 color means to ignore single-pixel text antialiasing
      // while retaining visible edge/corner loss and aspect-ratio distortion.
      const delta = Math.max(...[0, 1, 2].map(c => {
        let a=0,b=0;
        for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
          a+=actual.data[i+(dy*actual.width+dx)*4+c];
          b+=expected.data[j+(dy*expected.width+dx)*4+c];
        }
        return Math.abs(a-b)/9;
      }));
      // Compare edges of the fitted PICTURE separately from letterboxing. A
      // tiny landscape picture must not pass merely because most pixels black.
      const f=source.frame,inside=x>=f.left+1&&x<f.left+f.width-1&&y>=f.top+1&&y<f.top+f.height-1;
      const keys = ['all', ...(inside?['picture',...(y<f.top+f.height*.15?['top']:[]),...(y>f.top+f.height*.85?['bottom']:[]),
        ...(x<f.left+f.width*.15?['left']:[]),...(x>f.left+f.width*.85?['right']:[])]:[])];
      for (const key of keys) { regions[key][0] += delta > 35 ? 1 : 0; regions[key][1]++; }
    }
    for (const [edge, [different, total]] of Object.entries(regions)) {
      const tolerance=edge==='all'||edge==='picture'?.12:.35;
      if (different / total >= tolerance) {
        const folder = '.runtime/android-video-layout';
        await fs.mkdir(folder, { recursive: true });
        await fs.writeFile(`${folder}/${engine}-${label}-failed-actual.png`, actualBuffer);
        await fs.writeFile(`${folder}/${engine}-${label}-failed-source.png`, Buffer.from(source.png, 'base64'));
        await fs.writeFile(`${folder}/${engine}-${label}-failed.json`, JSON.stringify({ regions, video: await page.locator('video').evaluate(v => ({
          width: v.videoWidth, height: v.videoHeight, rect: v.getBoundingClientRect().toJSON(), controls: v.controls,
          time: v.currentTime, paused: v.paused, ready: v.readyState, fit: getComputedStyle(v).objectFit,
        })) }, null, 2));
      }
      assert.ok(different / total < tolerance, `${label}: ${edge} frame differs from uncropped source (${different}/${total})`);
    }
    if (process.env.CAPTURE_ANDROID_LAYOUT) {
      await fs.mkdir('.runtime/android-video-layout', { recursive: true });
      await fs.writeFile(`.runtime/android-video-layout/${engine}-${label}-actual.png`, actualBuffer);
      await fs.writeFile(`.runtime/android-video-layout/${engine}-${label}-source.png`, Buffer.from(source.png, 'base64'));
      await page.screenshot({ path: `.runtime/android-video-layout/${engine}-${label}-card.png` });
    }
  } finally {
    await page.locator('video').evaluate(v => { v.removeAttribute('data-layout-frame-capture'); v.controls = true; });
    await captureStyle.evaluate(el => el.remove());
  }
}
const android=engine==='firefox'?'Mozilla/5.0 (Android 14; Mobile; rv:146.0) Gecko/146.0 Firefox/146.0':'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/145.0.0.0 Mobile Safari/537.36';
async function geometry(page){return page.evaluate(()=>{
 const rect=selector=>document.querySelector(selector).getBoundingClientRect().toJSON();
 const card=document.querySelector('.video-player-surface');
 return {card:rect('.video-player-surface'),area:rect('.video-playback-area'),video:rect('video'),header:rect('.video-player-header'),controls:rect('.video-presentation-controls'),reactions:rect('.video-reactions'),scroll:card.scrollHeight,client:card.clientHeight};
});}
async function withoutAndroidCss(page){
 const before=await geometry(page);
 await page.evaluate(()=>{for(const sheet of document.styleSheets)if(sheet.ownerNode?.getAttribute('data-vite-dev-id')?.endsWith('/AndroidVideoPlayer.css'))sheet.disabled=true;});
 const prior=await geometry(page);
 await page.evaluate(()=>{for(const sheet of document.styleSheets)if(sheet.ownerNode?.getAttribute('data-vite-dev-id')?.endsWith('/AndroidVideoPlayer.css'))sheet.disabled=false;});
 assert.deepEqual(before,prior,'non-target geometry stays exactly unchanged');
}
async function landscapeIdle(page){
 const bar=page.locator('.video-presentation-controls');
 const hidden=()=>bar.evaluate(el=>el.classList.contains('video-controls-hidden'));
 const waitHidden=value=>page.waitForFunction(value=>{
   const el=document.querySelector('.video-presentation-controls');
   return el?.classList.contains('video-controls-hidden')===value&&(!value||getComputedStyle(el).opacity==='0');
 },value,{timeout:4500});
 const play=()=>page.locator('video').evaluate(v=>v.play());
 await page.locator('video').evaluate(v=>{v.pause();v.playbackRate=.0625;v.currentTime=0;});
 await page.waitForFunction(()=>!document.querySelector('video').seeking);
 const area=(await geometry(page)).area;
 await waitHidden(false);await play();
 await page.waitForTimeout(1500);assert.equal(await hidden(),false,'initial playback keeps mode controls visible briefly');
 await waitHidden(true);
 assert.equal(await bar.getAttribute('aria-hidden'),'true');
 assert.equal(await bar.evaluate(el=>el.hasAttribute('inert')),true);
 assert.equal(await bar.locator('button').first().evaluate(el=>getComputedStyle(el).pointerEvents),'none','faded controls cannot intercept video input');
 assert.equal(await page.locator('video').evaluate(v=>v.controls),true,'native normal-view controls remain enabled');
 assert.deepEqual((await geometry(page)).area,area,'idle never changes video sizing');
 const clickAllowed=await page.locator('video').evaluate(v=>{
   const r=v.getBoundingClientRect(),touch={identifier:1,target:v,clientX:r.left+80,clientY:r.top+80};
   for(const type of ['touchstart','touchend']){
     const e=new Event(type,{bubbles:true,cancelable:true});
     Object.defineProperties(e,{touches:{value:type==='touchstart'?[touch]:[]},changedTouches:{value:[touch]}});v.dispatchEvent(e);
   }
   return v.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,detail:1}));
 });
 assert.equal(clickAllowed,true,'tap reveals without blocking native playback/seek defaults');
 await waitHidden(false);assert.equal(await bar.evaluate(el=>el.hasAttribute('inert')),false);
 await page.locator('[data-video-fullscreen-toggle]').dispatchEvent('pointerdown',{pointerId:91,pointerType:'touch',bubbles:true});
 await page.waitForTimeout(2800);assert.equal(await hidden(),false,'held mode button cannot time out');
 await page.evaluate(()=>window.dispatchEvent(new PointerEvent('pointerup',{pointerId:91,pointerType:'touch'})));
 await waitHidden(true);
 await page.locator('video').evaluate(v=>v.pause());await waitHidden(false);
 await page.waitForTimeout(2800);assert.equal(await hidden(),false,'paused mode controls remain visible');
 await play();await waitHidden(true);
 await page.setViewportSize({width:390,height:844});await waitHidden(false);
 await page.waitForTimeout(2800);assert.equal(await hidden(),false,'Android portrait never auto-hides the in-flow bar');
 await page.setViewportSize({width:844,height:330});await waitHidden(true);
 await page.locator('video').evaluate(v=>{v.dispatchEvent(new Event('waiting'));v.pause();});await waitHidden(false);
 assert.ok(await page.evaluate(()=>window.normalIdleTimers.maximum<=1),'one normal-view idle timer at most');
 await page.locator('video').evaluate(v=>{v.playbackRate=1;});
 console.log(`PASS ${engine} Android landscape idle: hide/reveal, native controls, held button, pause/resume, rotation and single timer`);
}
async function open(page){
 await page.route('**/functions/v1/serve-media?*',r=>r.fulfill({json:{url:'/tests/fixtures/video-frame-edges.mp4'}}));
 await page.goto('http://127.0.0.1:5217/tests/public-previews.html');
 await page.evaluate(async()=>{
   const {supabase}=await import('/src/lib/supabase.ts');const original=supabase.rpc.bind(supabase);let own=null;
   window.layoutReactionWrites=[];
   supabase.rpc=async(name,args)=>{
     if(name==='get_media_reactions')return {data:args.p_ids.map(id=>({media_id:id,counts:own?{[own]:1}:{},own_reaction:own})),error:null};
     if(name==='set_media_reaction'){own=args.p_reaction;window.layoutReactionWrites.push(own);return {data:null,error:null};}
     return original(name,args);
   };
 });
 await page.getByRole('button',{name:'Fixture sign in',exact:true}).click();
 await page.getByRole('button',{name:'Play Public video',exact:true}).click();
 await page.waitForFunction(()=>{const v=document.querySelector('video');if(!v||v.readyState<2)return false;v.loop=true;v.pause();return true;});
}
try{
 const page=await browser.newPage({viewport:{width:390,height:844},userAgent:android,hasTouch:true,...(engine!=='firefox'?{isMobile:true}:{})});
 await page.addInitScript(()=>{
   const nativeSet=window.setTimeout.bind(window),nativeClear=window.clearTimeout.bind(window),live=new Set();
   window.normalIdleTimers={maximum:0,live};
   window.setTimeout=(fn,delay,...args)=>{
     if(delay!==2500)return nativeSet(fn,delay,...args);
     const id=nativeSet(()=>{live.delete(id);fn.apply(window,args);},delay);
     live.add(id);window.normalIdleTimers.maximum=Math.max(window.normalIdleTimers.maximum,live.size);return id;
   };
   window.clearTimeout=id=>{live.delete(id);nativeClear(id);};
 });
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await open(page);
 // Only the operating-system PiP boundary is mocked. Application handlers and
 // native element fullscreen remain real; physical PiP UI needs device testing.
 await page.locator('video').evaluate(v=>{
   let pip=null;
   Object.defineProperty(document,'pictureInPictureEnabled',{configurable:true,value:true});
   Object.defineProperty(document,'pictureInPictureElement',{configurable:true,get:()=>pip});
   Object.defineProperty(v,'requestPictureInPicture',{configurable:true,value:async()=>{pip=v;v.dispatchEvent(new Event('enterpictureinpicture'));}});
   Object.defineProperty(document,'exitPictureInPicture',{configurable:true,value:async()=>{pip=null;v.dispatchEvent(new Event('leavepictureinpicture'));}});
   v.dispatchEvent(new Event('loadedmetadata'));
 });
 for(const size of [{width:390,height:844},{width:844,height:390},{width:390,height:720},{width:844,height:260},{width:844,height:220},{width:844,height:330}]){
   await page.setViewportSize(size);await page.waitForTimeout(100);
   if(size.width<size.height){await withoutAndroidCss(page);continue;}
   const boxes=await geometry(page);
   assert.ok(boxes.scroll<=boxes.client+1,'normal landscape card must fit all rows without scrolling the picture away: '+JSON.stringify(boxes));
   for(const [name,b] of Object.entries(boxes).filter(([,value])=>typeof value==='object')){
     assert.ok(b.top>=0&&b.bottom<=size.height+1&&b.left>=0&&b.right<=size.width+1,name+' must fit the viewport');
   }
   assert.ok(Math.abs(boxes.area.height-(boxes.client-boxes.reactions.height))<=1,
     'video gets all card height except the compact reaction row: '+JSON.stringify(boxes));
   // Reproduce the previous in-flow header/control rows with identical card,
   // video fitting and reactions. Compare the PICTURE size, not black space.
   const oldRows=await page.addStyleTag({content:'.android-mobile-video .video-player-surface .video-player-header,.android-mobile-video .video-player-surface .video-presentation-controls{position:static!important;padding-block:2px!important;}'});
   const prior=await geometry(page);
   await oldRows.evaluate(el=>el.remove());
   assert.ok(boxes.area.height-prior.area.height>=88,'overlay rows return at least 88px to the video');
   console.log(`SIZE ${engine} ${size.width}x${size.height}: video height ${prior.area.height} -> ${boxes.area.height}`);
   const nativeHit=await page.evaluate(()=>{
     const v=document.querySelector('video'),r=v.getBoundingClientRect();
     return document.elementFromPoint(r.left+24,r.top+24)===v;
   });
   assert.ok(nativeHit,'decorative header passes input through to native video');
   assert.ok(boxes.controls.bottom<=boxes.area.bottom-64+1,'custom bar leaves native seek strip clear');
   for(const edge of ['top','bottom','left','right','width','height'])assert.ok(Math.abs(boxes.video[edge]-boxes.area[edge])<1,'video fits final playback area: '+edge);
   assert.deepEqual(await page.locator('video').evaluate(v=>[getComputedStyle(v).objectFit,getComputedStyle(v).objectPosition]),['contain','50% 50%']);
   await completeFrame(page,`${size.width}x${size.height}`);
   const old=await geometry(page);
   await page.locator('.video-reactions').evaluate(el=>{const extra=document.createElement('div');extra.dataset.layoutExtra='';extra.style.height='500px';el.append(extra);el.scrollTop=el.scrollHeight;});
   assert.ok(await page.locator('.video-reactions').evaluate(el=>el.scrollTop>0),'only reactions may scroll');
   assert.deepEqual((await geometry(page)).area,old.area,'tall reaction contents cannot change video geometry');
   await page.locator('[data-layout-extra]').evaluate(el=>el.remove());
 }
 // Windows Firefox decodes the edge-pattern fragmented MP4 but reports its
 // duration as 0.0994s. Use the existing WebM timeline fixture for transport
 // assertions; all normal-view edge/pixel checks above use the original MP4.
 console.log(`CHECK ${engine}: normal frame/rotation passed; checking playback`);
 await page.locator('video').evaluate(v=>{v.src='/tests/fixtures/playback-ended.webm';v.load();});
 await page.waitForFunction(()=>{const v=document.querySelector('video');return v.readyState>=2&&v.duration>1;});
 await page.locator('video').evaluate(v=>{v.currentTime=.5;});
 await page.waitForFunction(()=>{const v=document.querySelector('video');return !v.seeking&&Math.abs(v.currentTime-.5)<.1;});
 await page.locator('video').evaluate(v=>v.play());await page.waitForFunction(()=>document.querySelector('video').currentTime>.6);
 await page.locator('video').evaluate(v=>v.pause());assert.equal(await page.locator('video').evaluate(v=>v.paused),true);
 await landscapeIdle(page);
 console.log(`CHECK ${engine}: playback passed; checking fullscreen`);
 await page.getByRole('button',{name:'Enter fullscreen',exact:true}).click();
 await page.getByRole('button',{name:'Exit fullscreen',exact:true}).waitFor();
 await withoutAndroidCss(page);await completeFrame(page,'native-fullscreen');
 await page.getByRole('button',{name:'Exit fullscreen',exact:true}).click();
 await page.getByRole('button',{name:'Enter fullscreen',exact:true}).waitFor();
 const tapArea=(await geometry(page)).area;
 await page.touchscreen.tap(tapArea.left+80,tapArea.top+80);
 await page.touchscreen.tap(tapArea.left+80,tapArea.top+80);
 await page.getByRole('button',{name:'Exit fullscreen',exact:true}).waitFor();
 await page.getByRole('button',{name:'Exit fullscreen',exact:true}).click();
 await page.getByRole('button',{name:'Enter fullscreen',exact:true}).waitFor();
 // Also protect the existing CSS fullscreen fallback (used by unsupported APIs).
 await page.locator('.video-player-surface').evaluate(el=>{el.classList.add('video-page-fullscreen');el.closest('[data-task-modal]').classList.add('video-page-fullscreen-layer');});
 await withoutAndroidCss(page);await completeFrame(page,'page-fullscreen');
 await page.locator('.video-player-surface').evaluate(el=>{el.classList.remove('video-page-fullscreen');el.closest('[data-task-modal]').classList.remove('video-page-fullscreen-layer');});
 const normal=await geometry(page);
 console.log(`CHECK ${engine}: fullscreen passed; checking PiP return and reactions`);
 await page.getByRole('button',{name:'Enter picture-in-picture',exact:true}).click();
 await page.getByRole('button',{name:'Exit picture-in-picture',exact:true}).waitFor();
 await page.getByRole('button',{name:'Exit picture-in-picture',exact:true}).click();
 await page.getByRole('button',{name:'Enter picture-in-picture',exact:true}).waitFor();
 assert.deepEqual(await geometry(page),normal,'PiP return restores identical normal geometry');
 await page.locator('.video-reactions .reaction-add').click();await page.getByRole('group',{name:'Choose your reaction',exact:true}).waitFor();
 await page.getByRole('button',{name:'Smile',exact:true}).click();
 await page.locator('.video-reactions').getByRole('button',{name:'Your reaction: Smile. Click to remove',exact:true}).waitFor();
 await page.locator('.video-reactions').getByRole('button',{name:'Your reaction: Smile. Click to remove',exact:true}).click();
 await page.locator('.video-reactions').getByRole('button',{name:'Your reaction: Smile. Click to remove',exact:true}).waitFor({state:'hidden'});
 assert.deepEqual(await page.evaluate(()=>window.layoutReactionWrites),['smile',null]);
 await page.keyboard.press('Escape');assert.equal(await page.locator('.video-player-surface').count(),1);
 await page.locator('video').evaluate(v=>v.play());
 await page.waitForFunction(()=>window.normalIdleTimers.live.size===1);
 await page.getByRole('button',{name:'Close video player',exact:true}).click();
 assert.equal(await page.evaluate(()=>window.normalIdleTimers.live.size),0,'Close clears the idle timer');
 await page.getByRole('button',{name:'Play Public video',exact:true}).click();
 await page.locator('.video-player-surface').waitFor();
 assert.equal(await page.locator('.video-presentation-controls').evaluate(el=>el.classList.contains('video-controls-hidden')),false,'reopening resets visibility');
 await page.getByRole('button',{name:'Close video player',exact:true}).click();
 assert.equal(await page.evaluate(()=>window.normalIdleTimers.live.size),0,'reopened player also cleans up');
 assert.equal(await page.locator('[inert]').count(),0);assert.equal(await page.evaluate(()=>document.body.style.overflow),'');
 assert.deepEqual(errors,[]);await page.close();
 for(const [userAgent,touch] of [['Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile Safari/604.1',true],['Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/145.0',false],['Mozilla/5.0 (Linux; Android 14) Chrome/145.0 Safari/537.36',true]]){
   const other=await browser.newPage({viewport:{width:844,height:390},userAgent,hasTouch:touch});await open(other);await withoutAndroidCss(other);assert.equal(await other.locator('.android-mobile-video').count(),0);await other.close();
 }
 console.log(`PASS ${engine} Android: complete decoded frame/four edges at 390/330/260/220px landscape, repeated rotation, portrait/desktop/iPhone exclusion, play/pause/seek, double-tap, fullscreen, PiP API roundtrip, reactions and Close`);
}finally{await browser.close();await server.close();}
