"""Decoder checks; run in the preview-worker image, without network credentials."""
import io
import os
from pathlib import Path
import socket
import tempfile
import zipfile
from convert import block_network, validate_package


def rejected(label, data, extension='docx'):
    with tempfile.TemporaryDirectory(dir='/tmp') as temp:
        source = Path(temp) / ('source.' + extension); source.write_bytes(data)
        try: validate_package(source, extension)
        except Exception: print('PASS ' + label)
        else: raise AssertionError('Unsafe package accepted: ' + label)


def package(extra=None):
    data = io.BytesIO()
    with zipfile.ZipFile(data, 'w', zipfile.ZIP_DEFLATED) as archive:
        archive.writestr('[Content_Types].xml', '<Types/>')
        archive.writestr('word/document.xml', '<document/>')
        for name, content in (extra or {}).items(): archive.writestr(name, content)
    return data.getvalue()


rejected('corrupt input rejected', b'invalid archive')
rejected('wrong Office category rejected', package(), 'xlsx')
rejected('macros rejected', package({'word/vbaProject.bin': b'fake'}))
rejected('embedded objects rejected', package({'word/embeddings/oleObject.bin': b'fake'}))
rejected('external resources rejected', package({'word/_rels/document.xml.rels': '<Relationships><Relationship Type="image" TargetMode="External" Target="http://127.0.0.1/"/></Relationships>'}))
rejected('archive traversal rejected', package({'../private.txt': 'data'}))
rejected('oversized archive member rejected', package({'word/oversized.xml': b' ' * (31 * 1048576)}))
block_network()
for operation in [os.setsid, lambda: os.setpgid(0, 0)]:
    try: operation()
    except PermissionError: print('PASS decoder cannot escape its process group')
    else: raise AssertionError('Decoder can escape cancellation')
for family in [socket.AF_INET, socket.AF_INET6]:
    try: socket.socket(family)
    except PermissionError: print('PASS decoder network access denied: ' + str(family))
    else: raise AssertionError('Decoder can create network sockets')
try: Path('/proc/1/environ').read_bytes()
except PermissionError: print('PASS decoder cannot read coordinator credentials')
else: raise AssertionError('Decoder can inspect coordinator environment')
