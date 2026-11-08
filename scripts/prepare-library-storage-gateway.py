#!/usr/bin/env python3
"""Prepare a library-only Kong template addition; never overwrite live config.

The operator must back up the original, validate with the installed Kong runtime,
and install/reload the prepared result during the controlled cutover. Credentials
and unrelated YAML are preserved byte-for-byte, never parsed or printed.
"""
import argparse
from pathlib import Path
import re

BEGIN='  # BEGIN streamly-library-storage-signing\n'
END='  # END streamly-library-storage-signing\n'


def prepare(current,fragment):
    if '\r' in current or '\r' in fragment:
        raise ValueError('Expected native Linux LF configuration')
    fragment=fragment.strip('\n')+'\n'
    if not re.search(r'^- name: library-storage-signing$',fragment,re.M):
        raise ValueError('Expected the reviewed library gateway fragment')
    addition=BEGIN+''.join('  '+line+'\n' for line in fragment.splitlines())+END
    if current.count(BEGIN) or current.count(END):
        if current.count(BEGIN)!=1 or current.count(END)!=1:
            raise ValueError('Ambiguous gateway markers')
        start=current.index(BEGIN);finish=current.index(END)+len(END)
        if current[start:finish]!=addition:
            raise ValueError('An installed library route differs; review before replacing it')
        return current
    if 'name: library-storage-signing' in current:
        raise ValueError('Unmarked existing library route requires review')
    sections=list(re.finditer(r'^services:[ \t]*\n',current,re.M))
    if len(sections)!=1:
        raise ValueError('Expected exactly one block services list')
    start=sections[0].end()
    next_section=re.search(r'^[A-Za-z_][A-Za-z0-9_-]*:',current[start:],re.M)
    finish=start+next_section.start() if next_section else len(current)
    if not re.search(r'^  - name:',current[start:finish],re.M):
        raise ValueError('Unexpected services indentation/shape')
    prefix=current[:finish]
    if not prefix.endswith('\n'):prefix+='\n'
    return prefix+addition+current[finish:]


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('template',type=Path);parser.add_argument('fragment',type=Path);parser.add_argument('output',type=Path)
    args=parser.parse_args()
    result=prepare(args.template.read_text(),args.fragment.read_text())
    with args.output.open('x',encoding='utf-8',newline='\n') as handle:handle.write(result)
    print('Prepared configuration; no live installation or gateway reload performed.')
