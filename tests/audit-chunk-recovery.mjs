import assert from 'node:assert/strict';
import { chromium } from 'playwright';
const browser=await chromium.launch({headless:true,channel:process.env.BROWSER_CHANNEL||'msedge'});
try {
  const page=await browser.newPage({viewport:{width:1440,height:900}});
  const incoming={id:'fixture-call',conversation_id:'fixture-chat',name:'Fixture caller',media:'voice',state:'ringing',my_state:'invited',mine:false,seen:false,
    started_at:new Date().toISOString(),answered_at:null,ended_at:null,duration:0,outcome:null,
    members:[{id:'11111111-1111-4111-8111-111111111111',name:'Fixture',state:'invited'},{id:'other',name:'Fixture caller',state:'joined'}]};
  await page.route('https://upload-test.supabase.co/**',route=>{
    const request=route.request(),url=new URL(request.url()),body=request.postData()?request.postDataJSON():{};
    return route.fulfill({json:url.pathname.endsWith('/messenger_calls_rpc')?(body.p_action==='inbox'?[incoming]:null):url.pathname.endsWith('/messenger_rpc')?{conversations:[],unread:0}:url.pathname.endsWith('/is_admin')?false:[]});
  });
  await page.route('**/src/components/Messenger.tsx',route=>route.fulfill({status:404,body:'Asset not found'}));
  await page.goto(process.env.TEST_BASE_URL+'/tests/public-navigation.html');
  await page.getByText('Incoming voice call',{exact:true}).waitFor();
  // Browser/hash navigation can occur while the incoming-call modal is open.
  await page.evaluate(()=>{location.hash='#/messages';});
  await page.getByRole('heading',{name:'Something went wrong',includeHidden:true}).waitFor();
  assert.ok(await page.getByRole('button',{name:'Accept',exact:true}).isVisible());
  assert.ok(await page.locator('aside').getByRole('button',{name:'My Videos',exact:true,includeHidden:true}).isVisible());
  await page.evaluate(()=>{location.hash='#/public-videos';});
  await page.getByRole('heading',{name:'Discover videos',exact:true,includeHidden:true}).waitFor();
  assert.equal(await page.getByRole('heading',{name:'Something went wrong',includeHidden:true}).count(),0);
  assert.ok(await page.getByRole('button',{name:'Accept',exact:true}).isVisible());
  console.log('PASS failed lazy page preserves navigation and incoming call controls; switching pages recovers cleanly');
}finally{await browser.close();}
