"""Secret-location scan; never outputs a matched value or file contents."""
import json, re, subprocess
from pathlib import Path
root=Path.cwd()
files=subprocess.check_output(['git','ls-files','-z']).decode().split('\0')
hits=[]
patterns={
 'private_key':re.compile(r'-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----'),
 'resend_key':re.compile(r'\bre_[A-Za-z0-9_-]{24,}\b'),
 'github_token':re.compile(r'\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})\b'),
 'aws_access_key':re.compile(r'\b(?:AKIA|ASIA)[A-Z0-9]{16}\b'),
 'jwt_literal':re.compile(r'\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b'),
 'credential_assignment':re.compile(r'(?:PASSWORD|TURN_SHARED_SECRET|RESEND_API_KEY|SERVICE_ROLE_KEY|JWT_SECRET|secret|password)\s*[:=]\s*[\'\"]([^\'\"\n]{8,})[\'\"]',re.I)
}
for name in files:
 p=root/name
 if not name or not p.is_file() or p.stat().st_size>5_000_000:continue
 try:text=p.read_text('utf8')
 except (UnicodeError,OSError):continue
 for kind,pattern in patterns.items():
  for m in pattern.finditer(text):
   value=m.group(1) if kind=='credential_assignment' else m.group()
   obvious_fixture=any(t in value.lower() for t in ['example','placeholder','fixture','test','unknown','supabase','process.env','deno.env','getenv','crypto','redacted']) or '<' in value or '${' in value
   role=None
   if kind=='jwt_literal':
    try:
     import base64
     role=json.loads(base64.urlsafe_b64decode(value.split('.')[1]+'===' )).get('role')
    except Exception:pass
   hits.append({'file':name,'line':text[:m.start()].count('\n')+1,'type':kind,'tracked':True,'obvious_fixture_or_expression':obvious_fixture,**({'jwt_role':role} if role else {})})
history_env=subprocess.check_output(['git','log','--all','--format=%H','--','.env']).decode().splitlines()
result={'tracked_file_count':len([x for x in files if x]),'candidate_locations':hits,'tracked_env_files':[x for x in files if x=='.env' or x.endswith('/.env')],'commits_touching_root_env':len(history_env),'scope':'Current tracked text plus root .env history; not an exhaustive entropy/history scan'}
Path('audit/20261011/secret-scan.json').write_text(json.dumps(result,indent=2))
print(json.dumps(result,indent=2))
