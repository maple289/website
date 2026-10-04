import importlib.util
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('prepare', ROOT / 'scripts/prepare-migration.py')
prepare = importlib.util.module_from_spec(spec); spec.loader.exec_module(prepare)


class MigrationPreparation(unittest.TestCase):
    def test_existing_migrations_are_accepted(self):
        for path in (ROOT / 'supabase/migrations').glob('*.sql'):
            with self.subTest(file=path.name): prepare.normalize(path.read_text(encoding='utf-8-sig'))

    def test_function_body_strings_comments_preserved(self):
        body = "CREATE FUNCTION f() RETURNS void AS $f$ BEGIN PERFORM 'COMMIT;'; END; $f$ LANGUAGE plpgsql;"
        normalized = prepare.normalize("/* BEGIN; /* nested */ */ BEGIN; " + body + "\n-- COMMIT;\nCOMMIT;")
        self.assertIn(body, normalized)
        self.assertEqual(normalized.count('COMMIT'), 1)

    def test_invalid_transaction_is_rejected(self):
        for source in ['BEGIN; SELECT 1;', 'COMMIT;', 'BEGIN; BEGIN; COMMIT;', 'ROLLBACK;', 'SELECT 1', '\\q;']:
            with self.subTest(source=source), self.assertRaises(ValueError): prepare.normalize(source)

    def test_ledger_is_inside_locked_transaction(self):
        result = prepare.transaction('BEGIN; CREATE TABLE t(id int); COMMIT;', '123_test.sql')
        self.assertEqual(result.count('BEGIN;'), 1)
        self.assertEqual(result.count('COMMIT;'), 1)
        self.assertLess(result.index('pg_advisory_xact_lock'), result.index('CREATE TABLE'))
        self.assertLess(result.index('INSERT INTO streamly_internal'), result.index('COMMIT;'))


if __name__ == '__main__': unittest.main()
