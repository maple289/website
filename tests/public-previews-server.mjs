import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jgBsAAAAASUVORK5CYII=','base64');
// Fixed generated-preview fixture; no uploads, conversion or live database.
const stream='BT /F1 20 Tf 40 150 Td (Public generated preview) Tj ET';
const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 200] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`];
let pdf='%PDF-1.4\n',offsets=[0];for(let i=0;i<objects.length;i++){offsets.push(pdf.length);pdf+=`${i+1} 0 obj\n${objects[i]}\nendobj\n`;}const xref=pdf.length;pdf+=`xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(n=>String(n).padStart(10,'0')+' 00000 n \n').join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
export async function createPublicPreviewServer() {
return createServer({configFile:false,root:process.cwd(),plugins:[{name:'preview-fixtures',configureServer(s){s.middlewares.use((req,res,next)=>{
  const u=new URL(req.url,'http://127.0.0.1');
  if(u.pathname.startsWith('/storage/v1/object/sign/')){res.setHeader('Cache-Control',u.searchParams.has('fail')?'no-store':'public, max-age=3600');res.statusCode=u.searchParams.has('fail')?403:200;res.setHeader('Content-Type',u.searchParams.has('fail')?'application/json':'image/png');return res.end(u.searchParams.has('fail')?'{}':png);}
  if(u.pathname==='/functions/v1/serve-public-file'){res.setHeader('Content-Type','application/octet-stream');res.setHeader('Cache-Control','no-store');return res.end(png);}
  if(u.pathname==='/functions/v1/file-preview'){res.setHeader('Cache-Control','no-store');res.setHeader('Content-Type',u.searchParams.has('content')?'application/pdf':'application/json');return res.end(u.searchParams.has('content')?pdf:JSON.stringify({status:'available',kind:'pdf',mime:'application/pdf'}));}
  next();
});}},react()],resolve:{alias:{'@':path.resolve('src')}},define:{'import.meta.env.VITE_SUPABASE_URL':JSON.stringify('http://127.0.0.1:5217'),'import.meta.env.VITE_SUPABASE_ANON_KEY':JSON.stringify('public-preview-fixture')},server:{host:'127.0.0.1',port:5217,strictPort:true},optimizeDeps:{exclude:['lucide-react']}});
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const server=await createPublicPreviewServer();
  await server.listen();console.log('Isolated public preview UI: http://127.0.0.1:5217/tests/public-previews.html');
}
