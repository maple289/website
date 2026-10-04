"""Actual LibreOffice conversions, in a network-free disposable worker container.

Pass a read-only fixture directory containing sample.docx/.xlsx/.pptx. This test
uses no service credentials, Storage API or production database.
"""
import hashlib
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
from pypdf import PdfReader

fixtures=Path(sys.argv[1])
for extension in ['docx','xlsx','pptx']:
    with tempfile.TemporaryDirectory(prefix='audit-office-',dir='/work') as temp:
        root=Path(temp);root.chmod(0o755)
        source=root/('source.'+extension)
        shutil.copyfile(fixtures/('sample.'+extension),source);source.chmod(0o444)
        original=hashlib.sha256(source.read_bytes()).digest()
        output=root/'output';output.mkdir();os.chown(output,10002,10002)
        profile=root/'profile';profile.mkdir();os.chown(profile,10002,10002)
        result=subprocess.run(['python','/app/convert.py',str(source),extension,str(output),str(profile)],
            capture_output=True,text=True,timeout=120,user=10002,group=10002,extra_groups=[],start_new_session=True,
            env={'PATH':'/usr/local/bin:/usr/bin:/bin','HOME':str(profile),'TMPDIR':str(profile)})
        if result.returncode: raise AssertionError(extension+' conversion: '+result.stdout[-1500:]+result.stderr[-1500:])
        pdf=output/'source.pdf'
        assert pdf.is_file() and len(PdfReader(pdf).pages)>0,extension
        assert hashlib.sha256(source.read_bytes()).digest()==original,'Original changed'
        print('PASS '+extension+' PDF conversion, readable pages and unchanged original',flush=True)
