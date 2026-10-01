import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const env={SITE_NAME:'MyHostage',SITE_URL:'https://myhostage.ca/video/'};
globalThis.Deno={env:{get:name=>env[name]}};
let source=readFileSync('supabase/functions/_shared/registration-templates.ts','utf8').replace('import { escapeHtml } from "./email.ts";',`const escapeHtml=(value)=>value.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));`);
const js=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText;
const {registrationTemplate}=await import('data:text/javascript;base64,'+Buffer.from(js).toString('base64'));
const browser=await chromium.launch({headless:true,channel:process.env.BROWSER_CHANNEL || 'msedge'});
try {
 for(const kind of ['receipt','approved'])for(const width of [320,390,768,1440]){
  const mail=registrationTemplate(kind,'A'.repeat(100));
  const p=await browser.newPage({viewport:{width,height:950}});await p.setContent(mail.html);
  assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  assert.equal(await p.locator('h1').innerText(),mail.subject);
  assert.equal(await p.getByRole('link',{name:kind==='receipt'?'Visit website':'Sign in and set your password',exact:true}).getAttribute('href'),kind==='receipt'?'https://myhostage.ca/video/':'https://myhostage.ca/video/#/login');
  if(width===390)await p.screenshot({path:'.runtime/registration-'+kind+'-mobile.png',fullPage:true});
  console.log('PASS '+kind+' email '+width+'px: layout, long name, heading and link');await p.close();
 }
 const escaped=registrationTemplate('receipt','<script>');assert.ok(escaped.html.includes('&lt;script&gt;'));assert.ok(!escaped.html.includes('<script>'));
 env.SITE_URL='javascript:alert(1)';assert.throws(()=>registrationTemplate('approved'));
 console.log('PASS escaped names and unsafe website URL rejection');
}finally{await browser.close()}
