#!/usr/bin/env python3
"""Put deployed SQL migrations inside one atomic transaction, including the ledger.

Only top-level transaction wrappers are removed; quoted SQL function bodies and
comments are preserved. Existing migrations are never rewritten on disk.
"""
import argparse
from pathlib import Path
import re


def normalize(source):
    statements = []
    start = index = 0
    token = []
    while index < len(source):
        if source.startswith('--', index):
            end = source.find('\n', index)
            index = len(source) if end < 0 else end + 1
            continue
        if source.startswith('/*', index):
            depth = 1
            index += 2
            while depth and index < len(source):
                if source.startswith('/*', index): depth += 1; index += 2
                elif source.startswith('*/', index): depth -= 1; index += 2
                else: index += 1
            if depth: raise ValueError('Unterminated SQL comment')
            continue
        char = source[index]
        if char in "'\"":
            quote = char
            # PostgreSQL E'...' strings may escape a quote with a backslash.
            escaped = quote == "'" and index > 0 and source[index - 1] in 'Ee' and (index < 2 or not source[index - 2].isalnum())
            token.append('QUOTED')
            index += 1
            while index < len(source):
                if escaped and source[index] == '\\': index += 2; continue
                if source[index] == quote:
                    index += 1
                    if index < len(source) and source[index] == quote: index += 1; continue
                    break
                index += 1
            else: raise ValueError('Unterminated SQL string')
            continue
        if char == '$':
            marker = re.match(r'\$(?:[A-Za-z_][A-Za-z_0-9]*)?\$', source[index:])
            if marker:
                end = source.find(marker[0], index + len(marker[0]))
                if end < 0: raise ValueError('Unterminated SQL function body')
                token.append('QUOTED')
                index = end + len(marker[0])
                continue
        if char == ';':
            statements.append((start, index + 1, ''.join(token).strip().upper()))
            start = index + 1; token = []
        else: token.append(char)
        index += 1
    if ''.join(token).strip():
        raise ValueError('Migration must end its last statement with a semicolon')
    opened = False
    changes = []
    for begin, end, statement in statements:
        words = statement.split()
        if not words: continue
        if statement in ('BEGIN', 'BEGIN TRANSACTION', 'START TRANSACTION'):
            if opened: raise ValueError('Nested migration transactions are unsupported')
            opened = True; changes.append((begin, end))
        elif statement in ('COMMIT', 'COMMIT TRANSACTION', 'END', 'END TRANSACTION'):
            if not opened: raise ValueError('Unmatched migration COMMIT')
            opened = False; changes.append((begin, end))
        elif words[0] in ('BEGIN', 'START', 'COMMIT', 'END', 'ROLLBACK', 'SAVEPOINT', 'RELEASE'):
            raise ValueError('Unsupported transaction command: ' + statement)
        elif '\\' in statement:
            raise ValueError('psql commands are not allowed in migrations')
    if opened: raise ValueError('Unclosed migration transaction')
    for begin, end in reversed(changes):
        source = source[:begin] + '\n' + source[end:]
    return source


def transaction(source, version):
    if not re.fullmatch(r'[0-9A-Za-z_.-]+', version): raise ValueError('Unsafe migration filename')
    return ("BEGIN;\nSELECT pg_advisory_xact_lock(hashtextextended('streamly-schema-migrations',0));\n"
        "SELECT EXISTS(SELECT 1 FROM streamly_internal.schema_migrations WHERE version='" + version + "') AS applied \\gset\n"
        "\\if :applied\n\\echo Already applied: " + version + "\n\\else\n" + normalize(source) +
        "\nINSERT INTO streamly_internal.schema_migrations(version) VALUES('" + version + "');\n\\endif\nCOMMIT;\n")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('migration', type=Path)
    parser.add_argument('--transaction', action='store_true')
    args = parser.parse_args()
    source = args.migration.read_text(encoding='utf-8-sig')
    print(transaction(source, args.migration.name) if args.transaction else normalize(source))


if __name__ == '__main__': main()
