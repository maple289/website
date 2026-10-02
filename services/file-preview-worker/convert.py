"""Unprivileged Office decoder. No service credentials are inherited."""
import ctypes
import errno
import json
import os
import resource
from pathlib import Path
import subprocess
import sys
import zipfile
from defusedxml import ElementTree as ET
from pypdf import PdfReader

MAX_EXPANDED = 100 * 1024 * 1024


def block_network():
    # Allow Unix sockets used internally by LO, deny IPv4/IPv6 including loopback.
    class ArgCmp(ctypes.Structure):
        _fields_ = [('arg', ctypes.c_uint), ('op', ctypes.c_uint), ('a', ctypes.c_uint64), ('b', ctypes.c_uint64)]
    lib = ctypes.CDLL('libseccomp.so.2')
    lib.seccomp_init.argtypes = [ctypes.c_uint32]
    lib.seccomp_init.restype = ctypes.c_void_p
    lib.seccomp_syscall_resolve_name.argtypes = [ctypes.c_char_p]
    lib.seccomp_rule_add.argtypes = [ctypes.c_void_p, ctypes.c_uint32, ctypes.c_int, ctypes.c_uint, ArgCmp]
    lib.seccomp_load.argtypes = [ctypes.c_void_p]
    lib.seccomp_release.argtypes = [ctypes.c_void_p]
    context = lib.seccomp_init(0x7fff0000)  # ALLOW
    if not context:
        raise RuntimeError('Decoder sandbox unavailable')
    try:
        syscall = lib.seccomp_syscall_resolve_name(b'socket')
        for family in (2, 10):
            if lib.seccomp_rule_add(context, 0x50000 | errno.EPERM, syscall, 1, ArgCmp(0, 4, family, 0)) != 0:
                raise RuntimeError('Decoder network isolation unavailable')
        # Keep all decoder children inside the process group that the coordinator
        # kills on timeout/cancellation; a daemon must not outlive its input job.
        for name in (b'setsid', b'setpgid'):
            if lib.seccomp_rule_add(context, 0x50000 | errno.EPERM, lib.seccomp_syscall_resolve_name(name), 0, ArgCmp()) != 0:
                raise RuntimeError('Decoder process isolation unavailable')
        if lib.seccomp_load(context) != 0:
            raise RuntimeError('Decoder network isolation unavailable')
    finally:
        lib.seccomp_release(context)


def validate_package(source, extension):
    expected = {'docx': 'word/document.xml', 'xlsx': 'xl/workbook.xml', 'pptx': 'ppt/presentation.xml'}[extension]
    with zipfile.ZipFile(source) as archive:
        entries = archive.infolist()
        if len(entries) > 10000 or sum(item.file_size for item in entries) > MAX_EXPANDED:
            raise ValueError('The document is too large or complex to preview.')
        names = [item.filename for item in entries]
        if len(set(names)) != len(names) or expected not in names or '[Content_Types].xml' not in names:
            raise ValueError('This file is not a valid Office document.')
        for item in entries:
            if item.flag_bits & 1:
                raise ValueError('Password-protected documents cannot be previewed.')
            name = item.filename.lower()
            if 'vbaproject' in name or '/embeddings/' in name or '/externallinks/' in name:
                raise ValueError('Documents with macros, embedded objects or external data cannot be previewed.')
            if item.filename.startswith('/') or '..' in Path(item.filename).parts:
                raise ValueError('This file is not a valid Office document.')
            if item.file_size > 30 * 1024 * 1024:
                raise ValueError('The document is too large or complex to preview.')
            if name.endswith('.rels'):
                root = ET.fromstring(archive.read(item))
                for relation in root:
                    if relation.get('TargetMode') == 'External' and not relation.get('Type', '').endswith('/hyperlink'):
                        raise ValueError('Documents with external resources cannot be previewed.')
        if extension == 'xlsx':
            cells = 0
            sheets = [item for item in entries if item.filename.startswith('xl/worksheets/sheet') and item.filename.endswith('.xml')]
            if len(sheets) > 100:
                raise ValueError('This workbook has too many sheets to preview.')
            for sheet in sheets:
                with archive.open(sheet) as stream:
                    for _, element in ET.iterparse(stream, events=('end',)):
                        if element.tag.endswith('}c'):
                            cells += 1
                            if cells > 200000:
                                raise ValueError('This workbook has too many cells to preview.')
                        element.clear()


def convert(source, extension, output, profile):
    resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
    resource.setrlimit(resource.RLIMIT_FSIZE, (50 * 1048576, 50 * 1048576))
    resource.setrlimit(resource.RLIMIT_CPU, (110, 115))
    resource.setrlimit(resource.RLIMIT_AS, (2500 * 1048576, 2500 * 1048576))
    block_network()
    validate_package(source, extension)
    # Disable macros and automatic link updates even for otherwise valid packages.
    profile.mkdir(parents=True, exist_ok=True)
    (profile / 'user').mkdir(exist_ok=True)
    (profile / 'user/registrymodifications.xcu').write_text('''<?xml version="1.0"?>
<oor:items xmlns:oor="http://openoffice.org/2001/registry">
<item oor:path="/org.openoffice.Office.Common/Security/Scripting"><prop oor:name="MacroSecurityLevel" oor:op="fuse"><value>3</value></prop></item>
<item oor:path="/org.openoffice.Office.Calc/Content/Update"><prop oor:name="Link" oor:op="fuse"><value>0</value></prop></item>
</oor:items>''')
    filter_name = {'docx': 'writer_pdf_Export', 'xlsx': 'calc_pdf_Export', 'pptx': 'impress_pdf_Export'}[extension]
    options = json.dumps({'PageRange': {'type': 'string', 'value': '1-200'}})
    command = ['libreoffice', '-env:UserInstallation=' + profile.as_uri(), '--headless', '--nologo',
               '--nodefault', '--norestore', '--convert-to', 'pdf:' + filter_name + ':' + options,
               '--outdir', str(output), str(source)]
    result = subprocess.run(command, capture_output=True, text=True)
    # Server-only diagnostics; output may contain local paths but never credentials.
    print(json.dumps({'operation': 'libreoffice_conversion', 'exit': result.returncode,
                      'stdout': result.stdout[-12000:], 'stderr': result.stderr[-12000:]}), flush=True)
    pdf = output / 'source.pdf'
    if result.returncode or not pdf.exists() or not pdf.stat().st_size:
        raise ValueError('Preview could not be generated. The document may be corrupted or password-protected.')
    with pdf.open('rb') as stream:
        if stream.read(5) != b'%PDF-':
            raise ValueError('Preview could not be generated.')
    reader = PdfReader(pdf, strict=True)
    if not reader.pages or len(reader.pages) > 200:
        raise ValueError('This document exceeds the 200-page preview limit.')
    print(json.dumps({'operation': 'preview_validated', 'pages': len(reader.pages)}), flush=True)


if __name__ == '__main__':
    try:
        convert(Path(sys.argv[1]), sys.argv[2], Path(sys.argv[3]), Path(sys.argv[4]))
    except Exception as cause:
        message = str(cause) if isinstance(cause, ValueError) else 'Preview could not be generated. The document may be corrupted.'
        print(json.dumps({'operation': 'preview_decoder_failed', 'type': type(cause).__name__, 'message': str(cause)}), file=sys.stderr)
        # Parent exposes only this deliberate user-facing message, never a traceback.
        print(json.dumps({'user_error': message}), flush=True)
        sys.exit(1)
