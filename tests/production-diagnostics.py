import contextlib
import io
import json
from pathlib import Path
import runpy
from types import SimpleNamespace
import unittest
from unittest.mock import patch


class DiagnosticsTests(unittest.TestCase):
    def test_read_only_commands_and_private_output(self):
        calls = []

        def run(arguments, **_):
            calls.append(arguments)
            if arguments[1] == 'inspect':
                output = json.dumps([{'State': {'Status': 'restarting', 'ExitCode': 1}, 'RestartCount': 3,
                    'Config': {'Env': ['PGRST_DB_URI=postgres://actor:fixture-password@db/app',
                        'JWT_SECRET=fixture-private-signing-value', 'PGRST_DB_CONFIG=true']}}])
                return SimpleNamespace(returncode=0, stdout=output, stderr='')
            return SimpleNamespace(returncode=0, stdout='', stderr='Database connection failed: postgres://actor:fixture-password@db/app\nfixture-private-signing-value\nfixture@example.invalid\n')

        output = io.StringIO()
        with patch('subprocess.run', run), contextlib.redirect_stdout(output):
            runpy.run_path(str(Path(__file__).resolve().parents[1] / 'scripts/production-health-diagnostics.py'))
        text = output.getvalue()
        for value in ['fixture-password', 'fixture-private-signing-value', 'fixture@example.invalid']:
            self.assertNotIn(value, text)
        self.assertIn('Database connection failed', text)
        self.assertIn('PGRST_DB_CONFIG=true', text)
        self.assertTrue(all(call[:2] in [['docker', 'inspect'], ['docker', 'logs']] for call in calls))


if __name__ == '__main__':
    unittest.main()
