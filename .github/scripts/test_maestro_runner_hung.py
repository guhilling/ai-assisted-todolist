"""
Pins down the case mobile/maestro/driver-failed.sh learnt for #473: on the iPhone simulator, a tap
on Open in iOS's question hung in the XCTest runner while the app it opened was starting. The
runner gave the request up after 100 s, and Maestro failed the tap with an error of no name of its
own, which its JUnit report calls "Unknown error". run-on-simulator.sh runs the flow once more after
that, so the script must say "the driver's" for the three together, and for no fewer: an unknown
error by itself may be the flow's, and its failure would be hidden.

Each test hands the script files named and written the way Maestro and its runner write them:
Maestro's console output, its JUnit report, its own log and the XCTest runner's.
test_maestro_driver_failed.py has the script's other cases.

Run with:  python3 -m unittest discover -s .github/scripts -p 'test_*.py'
"""

import pathlib
import subprocess
import tempfile
import unittest

SCRIPT = pathlib.Path(__file__).resolve().parents[2] / "mobile" / "maestro" / "driver-failed.sh"

# The console of run 41287656097's first attempt: no reason given.
CONSOLE = """\
Waiting for flows to complete...
[Failed] Share a photo into the app through iOS's share sheet (6m 30s)

1/1 Flow Failed
"""
# Its report.
UNKNOWN_ERROR = """\
<testcase id="Share a photo into the app through iOS's share sheet" status="ERROR">
  <failure>Unknown error</failure>
</testcase>
"""
# Maestro's log on it.
TAP_FAILED = (
    "08:27:32.663 [ INFO] maestro.cli.runner.CliConsoleListener.onCommandFinished: "
    "Tap on \"Open\" FAILED\n"
    "08:27:32.675 [ERROR] maestro.orchestra.Orchestra.executeCommands: "
    "[Command execution] CommandFailed: null\n"
)
# Its XCTest runner's log, around the tap on Open.
RUNNER_HUNG = (
    "2026-11-01 08:24:27.610648+0000 maestro-driver-iosUITests-Runner[20042:65019] "
    "Tapping 275.0, 474.0\n"
    "2026-11-01 08:27:16.553666+0000 maestro-driver-iosUITests-Runner[20042:65019] "
    "Tapping took 61.492074966430664\n"
    "2026-11-01 08:27:16.917124+0000 maestro-driver-iosUITests-Runner[20042:92787] "
    "[FlyingFox] handler error: Task timed out before completion. Timeout: 100.0 seconds.\n"
)
# A runner's log from a run where nothing hung.
RUNNER_FINE = (
    "2026-11-01 08:38:23.006000+0000 maestro-driver-iosUITests-Runner[20042:65019] "
    "Tapping 275.0, 474.0\n"
)
# A report, and Maestro's log, where a check failed instead.
ASSERTION = """\
<testcase id="Share a photo into the app through iOS's share sheet" status="ERROR">
  <failure>Assertion is false: "Sign in with Keycloak" is visible</failure>
</testcase>
"""
ASSERTION_FAILED = (
    "11:39:49.125 [ INFO] maestro.cli.runner.CliConsoleListener.onCommandFinished: "
    "Assert that \"Sign in with Keycloak\" is visible FAILED\n"
)
# Maestro's log naming an app's crash: run again, the crash would be hidden.
APP_CRASH = (
    "08:27:32.663 [ERROR] maestro.drivers.IOSDriver: Detected app crash during tap command\n"
    "Caused by: maestro.utils.network.XCUITestServerError$AppCrash: Request for touch failed\n"
)
RUNNER_LOG = "xctest_runner_2026-11-01_081955.log"


class RunnerHungTest(unittest.TestCase):

    def run_on(self, files):
        """Runs the script on one file per name and content; returns its exit status."""
        with tempfile.TemporaryDirectory() as work:
            paths = []
            for name, content in files.items():
                path = pathlib.Path(work) / name
                path.write_text(content)
                paths.append(str(path))
            return subprocess.run(["bash", str(SCRIPT), *paths], capture_output=True).returncode

    def hung(self, **overrides):
        """The files of run 41287656097's first attempt; an override of None leaves one out."""
        files = {"console.txt": CONSOLE, "report.xml": UNKNOWN_ERROR, "maestro.log": TAP_FAILED,
                 RUNNER_LOG: RUNNER_HUNG}
        files.update(overrides)
        return {name: content for name, content in files.items() if content is not None}

    def test_the_runner_giving_up_a_tap_is_the_drivers(self):
        self.assertEqual(self.run_on(self.hung()), 0)

    def test_an_unknown_error_alone_is_the_flows(self):
        # Without the runner's word for it, the flow may have failed by itself.
        self.assertEqual(self.run_on(self.hung(**{RUNNER_LOG: RUNNER_FINE})), 1)
        self.assertEqual(self.run_on(self.hung(**{RUNNER_LOG: None})), 1)

    def test_a_hung_request_before_a_failed_check_is_the_flows(self):
        # The runner got over it, and the flow went on to fail by itself.
        self.assertEqual(self.run_on(self.hung(**{"report.xml": ASSERTION,
                                                  "maestro.log": ASSERTION_FAILED})), 1)

    def test_a_hung_request_needs_a_tap_that_failed(self):
        self.assertEqual(self.run_on(self.hung(**{"maestro.log": ASSERTION_FAILED})), 1)
        self.assertEqual(self.run_on(self.hung(**{"maestro.log": None})), 1)

    def test_an_exception_only_maestros_log_names_is_the_flows(self):
        # The logs name exceptions Maestro got over, and an app's crash: a failed check after one
        # is still the flow's, as before #473, when the logs were not read.
        self.assertEqual(self.run_on({"console.txt": CONSOLE, "report.xml": ASSERTION,
                                      "maestro.log": APP_CRASH}), 1)

    def test_a_runner_log_that_is_missing_says_nothing(self):
        self.assertEqual(subprocess.run(["bash", str(SCRIPT), "/nonexistent/" + RUNNER_LOG],
                                        capture_output=True).returncode, 1)


if __name__ == "__main__":
    unittest.main()
