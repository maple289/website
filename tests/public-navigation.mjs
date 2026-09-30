import assert from 'node:assert/strict';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser=await chromium.launch({headless:true,channel:process.env.BROWSER_CHANNEL || 'msedge'});
const base=process.env.TEST_BASE_URL || 'http://127.0.0.1:5199';
try{
  for(const width of [1440,768,375]){
    const page=await browser.newPage({viewport:{width,height:900},hasTouch:width<1024});
    const requests=[],errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.route('https://upload-test.supabase.co/**',route=>{
      const url=new URL(route.request().url());requests.push(url);
      return route.fulfill({json:url.pathname.endsWith('/is_admin')?false:[]});
    });
    const top=page.getByRole('navigation',{name:'Media navigation'});
    async function sidebar(label){
      if(width<1024)await page.getByRole('button',{name:'Open menu',exact:true}).click();
      await page.locator('aside').getByRole('button',{name:label,exact:true}).click();
    }
    async function assertPublic(target){
      const heading=target==='Videos'?'Discover videos':target==='Photos'?'Discover photos':'Public Files Library';
      await page.getByRole('heading',{name:heading,exact:true}).waitFor();
      assert.equal(await top.getByRole('button',{name:target,exact:true}).getAttribute('aria-current'),'page');
      const selectedSidebar=page.locator('aside button[aria-current=page]');
      assert.equal(await selectedSidebar.count()?await selectedSidebar.innerText():'',target==='Files'?'':'Home');
      if(target==='Files'){
        assert.equal(new URL(page.url()).hash,'#/public-files');
        assert.ok(requests.some(r=>r.pathname.endsWith('/list_public_user_files')));
        assert.equal(await page.getByRole('button',{name:'New folder',exact:true}).count(),0);
      }else{
        assert.equal(new URL(page.url()).hash,'');
        const table=target==='Videos'?'videos':'photos';
        assert.ok(requests.some(r=>r.pathname.endsWith('/'+table)&&r.searchParams.get('visibility')==='eq.public'));
      }
    }
    await page.goto(base+'/tests/public-navigation.html');
    await page.getByRole('heading',{name:'Discover videos',exact:true}).waitFor();
    for(const source of ['My Videos','My Photos','File Storage']){
      for(const target of ['Videos','Photos','Files']){
        await sidebar(source);
        const privateHeading=source==='My Videos'?'My Library':source==='My Photos'?'My Photos':'All files';
        await page.getByRole('heading',{name:privateHeading,exact:true}).waitFor();
        assert.equal(await page.locator('aside button[aria-current=page]').innerText(),source);
        assert.equal(await top.locator('button[aria-current=page]').count(),0);
        requests.length=0;await top.getByRole('button',{name:target,exact:true}).click();await assertPublic(target);
        // Back must return to the actual private route rather than leave it
        // selected in the public page. Forward must restore the public scope.
        await page.goBack();await page.getByRole('heading',{name:privateHeading,exact:true}).waitFor();
        await page.goForward();await assertPublic(target);
        console.log(`PASS ${width}px ${source} → public ${target}, active state, Back/Forward`);
      }
    }
    for(const target of ['Photos','Videos','Files','Photos','Files','Videos']){
      await top.getByRole('button',{name:target,exact:true}).click();await assertPublic(target);
    }
    assert.deepEqual(errors,[]);await page.close();
  }
  const guest=await browser.newPage();
  await guest.route('https://upload-test.supabase.co/**',route=>route.fulfill({json:[]}));
  await guest.goto(base+'/tests/public-navigation.html?guest');
  const top=guest.getByRole('navigation',{name:'Media navigation'});
  for(const [target,heading] of [['Photos','Discover photos'],['Files','Public Files Library'],['Videos','Discover videos']]){
    await top.getByRole('button',{name:target,exact:true}).click();await guest.getByRole('heading',{name:heading,exact:true}).waitFor();
    assert.equal(await top.getByRole('button',{name:target,exact:true}).getAttribute('aria-current'),'page');
    assert.equal(await guest.locator('aside').count(),0);console.log('PASS guest public '+target);
  }
}finally{await browser.close()}
