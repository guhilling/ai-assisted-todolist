"""
Pins down mobile/maestro/emulator-lost.sh, which tells an Android flow that failed because the
emulator itself went away from one that failed by itself or through Maestro's driver (#461). Mobile
CI runs the whole share once more, on a freshly booted emulator and a fresh stack, after the first
kind only; driver-failed.sh's failures are run again in place, on the same emulator.

Each test hands the script files written the way Maestro writes them: its console output and its
JUnit report.

Run with:  python3 -m unittest discover -s .github/scripts -p 'test_*.py'
"""

import pathlib
import subprocess
import tempfile
import unittest

SCRIPT = pathlib.Path(__file__).resolve().parents[2] / "mobile" / "maestro" / "emulator-lost.sh"

# The console of #450's first run: the emulator's process had gone, so adb no longer listed it.
NOT_FOUND = """\
Waiting for flows to complete...
[Failed] Reminders, turn them on (46s)

1/1 Flow Failed

Exception in thread "Thread-5" java.io.IOException: Command failed (host:transport:emulator-5554): device 'emulator-5554' not found
\tat dadb.adbserver.AdbServer.send$dadb(AdbServer.kt:103)
"""
# What its report said about it.
UNKNOWN_ERROR = """\
<testcase id="Reminders, turn them on" status="ERROR">
  <failure>Unknown error</failure>
</testcase>
"""
OFFLINE = ("maestro.android.DeviceServerDiedException: Device server died during 'deviceInfo' on "
           "emulator-5554\nCaused by: java.io.IOException: Command failed "
           "(host:transport:emulator-5554): device offline\n")
DRIVER_FAILED = ("maestro.android.DeviceCallFailedException: 'deviceInfo' failed: "
                 "INTERNAL - error in frame handler\n")
ASSERTION = '[Failed] Account and sign-out (1m 21s) (Assertion is false: "Username or email" is visible)\n'


class EmulatorLostTest(unittest.TestCase):

    def run_on(self, *contents):
        """Runs the script on one file per content; returns its exit status."""
        with tempfile.TemporaryDirectory() as work:
            files = []
            for n, content in enumerate(contents):
                path = pathlib.Path(work) / f"file-{n}"
                path.write_text(content)
                files.append(str(path))
            return subprocess.run(["bash", str(SCRIPT), *files], capture_output=True).returncode

    def test_the_emulator_no_longer_listed(self):
        self.assertEqual(self.run_on(NOT_FOUND, UNKNOWN_ERROR), 0)

    def test_the_emulator_no_longer_listed_in_a_later_file(self):
        # Any file may say it, not only the first: the script is handed the console and the report.
        self.assertEqual(self.run_on(UNKNOWN_ERROR, NOT_FOUND), 0)

    def test_the_emulator_merely_offline_is_not_lost(self):
        # adb calls an emulator offline for a moment now and then (emulator-ready.sh): a flow that
        # failed by itself meanwhile would be run again, and its failure hidden.
        self.assertEqual(self.run_on(OFFLINE), 1)

    def test_the_driver_failing_its_first_call_is_the_drivers(self):
        # driver-failed.sh's case: the emulator is still there, the flow runs again on it.
        self.assertEqual(self.run_on(DRIVER_FAILED), 1)

    def test_a_failed_check_is_the_flows(self):
        self.assertEqual(self.run_on(ASSERTION, UNKNOWN_ERROR), 1)

    def test_a_file_that_is_missing_says_nothing(self):
        self.assertEqual(self.run_on(), 1)
        self.assertEqual(subprocess.run(["bash", str(SCRIPT), "/nonexistent/report.xml"],
                                        capture_output=True).returncode, 1)


if __name__ == "__main__":
    unittest.main()
