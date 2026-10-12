// Small synthetic documents for local/CI browser checks; no user content.
import fs from 'node:fs/promises';
const folder='.runtime/preview-fixtures/';await fs.mkdir(folder,{recursive:true});
const text1='BT /F1 20 Tf 50 700 Td (Fixture page one) Tj ET',text2='BT /F1 20 Tf 50 700 Td (Fixture page two) Tj ET';
const objects=[
  '<< /Type /Catalog /Pages 2 0 R >>',
  '<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>',
  '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 7 0 R >> >> /Contents 4 0 R >>',
  `<< /Length ${text1.length} >>\nstream\n${text1}\nendstream`,
  '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 7 0 R >> >> /Contents 6 0 R >>',
  `<< /Length ${text2.length} >>\nstream\n${text2}\nendstream`,
  '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
];
let pdf='%PDF-1.4\n';const offsets=[0];
for(const [index,object] of objects.entries()){offsets.push(Buffer.byteLength(pdf));pdf+=`${index+1} 0 obj\n${object}\nendobj\n`;}
const xref=Buffer.byteLength(pdf);
pdf+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n`+offsets.slice(1).map(offset=>String(offset).padStart(10,'0')+' 00000 n \n').join('')+`trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
await fs.writeFile(folder+'sample.pdf',pdf);
await fs.writeFile(folder+'sample.png',Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a4AAAAABJRU5ErkJggg==','base64'));
for(const [name,text] of Object.entries({'sample.txt':'Safe text preview\n<script>alert(1)</script>','sample.json':'{"safe":true}','sample.xml':'<fixture>safe</fixture>','sample.csv':'Name,Value\n"Quoted, comma",123'}))await fs.writeFile(folder+name,text);
