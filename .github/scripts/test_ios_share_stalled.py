"""
Pins down mobile/maestro/ios/share-stalled.sh, which tells a share the simulator's own iOS stalled
before TaskFest's code ran from one that failed on TaskFest (#533). Mobile CI runs the iOS share
flow once more after the first kind only: Photos never finishing "Preparing..." even after the
flow's own restart, or Safari's menu never opening so its Share is not found. Every other failure,
TaskFest Dev missing from the sheet or the app not starting among them, still fails at once.

Each test hands the script Maestro's console output, as it writes it.

Run with:  python3 -m unittest discover -s .github/scripts -p 'test_*.py'
"""

import pathlib
import subprocess
import tempfile
import unittest

SCRIPT = pathlib.Path(__file__).resolve().parents[2] / "mobile" / "maestro" / "ios" / "share-stalled.sh"

PHOTOS_STUCK = """\
[Passed] launchApp
[Failed] Share a photo into the app through iOS's share sheet (5m 33s) (Assertion is false: "(Open in .TaskFest Dev.\\?|Sign in with Keycloak)" is visible)
1/1 Flow Failed
"""
SAFARI_MENU = """\
[Failed] Share a link from Safari into the app through iOS's share sheet (1m 26s) (Element not found: Text matching regex: Share)
1/1 Flow Failed
"""
NOT_OFFERED = """\
[Failed] Share a photo into the app through iOS's share sheet (1m 2s) (Element not found: Text matching regex: TaskFest Dev)
1/1 Flow Failed
"""
APP_NEVER_STARTED = """\
[Failed] Share a photo into the app through iOS's share sheet (7m 52s) (Assertion is false: "Sign in with Keycloak" is visible)
1/1 Flow Failed
"""
PASSED = """\
[Passed] Share a photo into the app through iOS's share sheet (48s)
1/1 Flow Passed
"""


def stalled(console: str) -> bool:
    with tempfile.NamedTemporaryFile("w", suffix=".txt", delete=False) as file:
        file.write(console)
    return subprocess.run(["bash", str(SCRIPT), file.name]).returncode == 0


class ShareStalled(unittest.TestCase):
    def test_photos_never_finishing_is_the_simulators(self):
        self.assertTrue(stalled(PHOTOS_STUCK))

    def test_safaris_menu_never_opening_is_the_simulators(self):
        self.assertTrue(stalled(SAFARI_MENU))

    def test_taskfest_dev_missing_from_the_sheet_fails_at_once(self):
        self.assertFalse(stalled(NOT_OFFERED))

    def test_the_app_not_starting_after_the_share_fails_at_once(self):
        self.assertFalse(stalled(APP_NEVER_STARTED))

    def test_a_flow_that_passed_is_no_stall(self):
        self.assertFalse(stalled(PASSED))

    def test_a_missing_console_is_no_stall(self):
        self.assertNotEqual(subprocess.run(["bash", str(SCRIPT), "/nonexistent/console.txt"],
                                           capture_output=True).returncode, 0)


if __name__ == "__main__":
    unittest.main()
