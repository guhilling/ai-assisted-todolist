"""
Pins down .claude/hooks/cloud-session-rules.py (#458): in a cloud session it prints the shared
rules from the tag .claude/settings.json pins, or a warning if they cannot be fetched; anywhere
else it prints nothing, because the plugin already brought them.

Nothing here reaches the network: urlopen is replaced.

Run with:  python3 -m unittest discover -s .github/scripts -p 'test_*.py'
"""

import contextlib
import importlib.util
import io
import os
import pathlib
import unittest
from unittest import mock

ROOT = pathlib.Path(__file__).resolve().parents[2]
_spec = importlib.util.spec_from_file_location(
    "cloud_session_rules", ROOT / ".claude" / "hooks" / "cloud-session-rules.py")
hook = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(hook)


class CloudSessionRulesTest(unittest.TestCase):

    def run_hook(self, remote, urlopen):
        out = io.StringIO()
        with mock.patch.dict(os.environ, {"CLAUDE_CODE_REMOTE": remote}), \
                mock.patch.object(hook.urllib.request, "urlopen", urlopen), \
                contextlib.redirect_stdout(out):
            self.assertEqual(hook.main(), 0)
        return out.getvalue()

    def test_the_rules_come_from_the_pinned_tag(self):
        self.assertRegex(hook.rules_url(hook.SETTINGS),
                         r"^https://raw\.githubusercontent\.com/guhilling/dev-conventions/"
                         r"v\d+\.\d+\.\d+/plugins/conventions/rules\.md$")

    def test_a_cloud_session_gets_the_rules(self):
        urlopen = mock.MagicMock()
        urlopen.return_value.__enter__.return_value.read.return_value = b"# Shared rules\n"
        self.assertIn("# Shared rules", self.run_hook("true", urlopen))
        urlopen.assert_called_once()
        self.assertEqual(urlopen.call_args.args[0], hook.rules_url(hook.SETTINGS))

    def test_a_failed_fetch_is_a_warning_in_the_context(self):
        urlopen = mock.MagicMock(side_effect=OSError("blocked by the proxy"))
        output = self.run_hook("true", urlopen)
        self.assertTrue(output.startswith("WARNING"))
        self.assertIn("blocked by the proxy", output)

    def test_a_local_session_gets_nothing_from_it(self):
        urlopen = mock.MagicMock()
        self.assertEqual(self.run_hook("", urlopen), "")
        urlopen.assert_not_called()


if __name__ == "__main__":
    unittest.main()
