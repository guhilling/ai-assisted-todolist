"""
Pins down the case mobile/maestro/driver-failed.sh learnt for #473: on the iPhone simulator, a tap
on Open in iOS's question hung in the XCTest runner while the app it opened was starting. The
runner gave the request up after 100 s, and Maestro failed with an error of no name of its own,
which its JUnit report calls "Unknown error". run-on-simulator.sh runs the flow once more after
that, so the script must say "the driver's" for the two together, and for neither alone: an unknown
error by itself may be the flow's, and its failure would be hidden.

Each test hands the script files written the way Maestro and its runner write them: Maestro's
console output, its JUnit report and the XCTest runner's log. test_maestro_driver_failed.py has the
script's other cases.

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
# Its XCTest runner's log, around the tap on Open.
RUNNER_HUNG = """\
2026-11-01 08:24:27.610648+0000 maestro-driver-iosUITests-Runner[20042:65019] Tapping 275.0, 474.0
2026-11-01 08:26:19.460253+0000 maestro-driver-iosUITests-Runner[20042:65810] [FlyingFox] <127.0.0.1> close connection
2026-11-01 08:27:16.553666+0000 maestro-driver-iosUITests-Runner[20042:65019] Tapping took 61.492074966430664
2026-11-01 08:27:16.917124+0000 maestro-driver-iosUITests-Runner[20042:92787] [FlyingFox] handler error: Task timed out before completion. Timeout: 100.0 seconds.
"""
# A runner's log from a run where nothing hung.
RUNNER_FINE = """\
2026-11-01 08:38:23.006000+0000 maestro-driver-iosUITests-Runner[20042:65019] Tapping 275.0, 474.0
2026-11-01 08:38:23.400000+0000 maestro-driver-iosUITests-Runner[20042:65019] Tapping took 0.39
"""
ASSERTION = """\
<testcase id="Share a photo into the app through iOS's share sheet" status="ERROR">
  <failure>Assertion is false: "Sign in with Keycloak" is visible</failure>
</testcase>
"""


class RunnerHungTest(unittest.TestCase):

    def run_on(self, *contents):
        """Runs the script on one file per content; returns its exit status."""
        with tempfile.TemporaryDirectory() as work:
            files = []
            for n, content in enumerate(contents):
                path = pathlib.Path(work) / f"file-{n}"
                path.write_text(content)
                files.append(str(path))
            return subprocess.run(["bash", str(SCRIPT), *files], capture_output=True).returncode

    def test_the_runner_giving_up_a_tap_is_the_drivers(self):
        self.assertEqual(self.run_on(CONSOLE, UNKNOWN_ERROR, RUNNER_HUNG), 0)

    def test_in_any_order(self):
        self.assertEqual(self.run_on(RUNNER_HUNG, CONSOLE, UNKNOWN_ERROR), 0)

    def test_an_unknown_error_alone_is_the_flows(self):
        # Without the runner's word for it, the flow may have failed by itself.
        self.assertEqual(self.run_on(CONSOLE, UNKNOWN_ERROR, RUNNER_FINE), 1)
        self.assertEqual(self.run_on(CONSOLE, UNKNOWN_ERROR), 1)

    def test_a_hung_request_in_a_flow_that_failed_a_check_is_the_flows(self):
        # The runner recovered, and the flow went on to fail by itself.
        self.assertEqual(self.run_on(CONSOLE, ASSERTION, RUNNER_HUNG), 1)

    def test_a_runner_log_that_is_missing_says_nothing(self):
        self.assertEqual(subprocess.run(["bash", str(SCRIPT), "/nonexistent/xctest_runner.log"],
                                        capture_output=True).returncode, 1)


if __name__ == "__main__":
    unittest.main()
