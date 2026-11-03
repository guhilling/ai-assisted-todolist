"""
Pins check-compose-env.py (#511): a Compose variable whose default is empty is refused, because the
backend then receives the variable set to nothing, and Quarkus' ${...:default} keeps the nothing.

Run with:  python3 -m unittest discover -s .github/scripts -p 'test_*.py'
"""

import importlib.util
import pathlib
import tempfile
import unittest

HERE = pathlib.Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("check_compose_env", HERE / "check-compose-env.py")
check = importlib.util.module_from_spec(spec)
spec.loader.exec_module(check)


class EmptyDefaults(unittest.TestCase):
    def findings(self, text):
        with tempfile.TemporaryDirectory() as directory:
            path = pathlib.Path(directory) / "docker-compose.yml"
            path.write_text(text)
            return check.empty_defaults(path)

    def test_refuses_an_empty_default(self):
        found = self.findings("    environment:\n      CLIENT_ID: ${CLIENT_ID:-}\n")
        self.assertEqual([(2, "CLIENT_ID")], found)

    def test_refuses_an_empty_default_without_the_colon(self):
        self.assertEqual([(1, "SECRET")], self.findings("SECRET: ${SECRET-}\n"))

    def test_accepts_a_default_with_a_value(self):
        self.assertEqual([], self.findings("ORIGINS: ${ORIGINS:-http://localhost:3000}\n"))

    def test_accepts_a_variable_without_a_default(self):
        self.assertEqual([], self.findings("IMAGE: ${BACKEND_IMAGE}\n"))

    def test_the_repositorys_compose_files_have_none(self):
        found = {str(path): check.empty_defaults(path) for path in check.compose_files()}
        self.assertTrue(found, "no Compose files found")
        self.assertEqual({}, {path: hits for path, hits in found.items() if hits})


if __name__ == "__main__":
    unittest.main()
