"""
Pins down mobile/maestro/driver-failed.sh, which tells a failure of Maestro's own driver from a
failure of the flow. Mobile CI runs the iOS share flow once more after the first kind only (#401):
on a freshly booted simulator the driver sometimes starts too slowly, or goes away mid-tap, before
anything is shared. A flow that fails a check, or Photos never finishing, still fails at once.
The Android flows do the same (#445): the emulator's driver has failed its first call, before any
step ran.

Each test hands the script files written the way Maestro writes them: its console output and its
JUnit report.

Run with:  python3 -m unittest discover -s .github/scripts -p 'test_*.py'
"""

import pathlib
import subprocess
import tempfile
import unittest

SCRIPT = pathlib.Path(__file__).resolve().parents[2] / "mobile" / "maestro" / "driver-failed.sh"

UNREACHABLE = """\
<testcase id="Share a photo" status="ERROR">
  <failure>maestro.DeviceUnreachableException: Device became unreachable during deviceInfo
\tat maestro.drivers.IOSDriver.runDeviceCall(IOSDriver.kt:645)
Caused by: maestro.utils.network.XCUITestServerError$Unreachable: Transport unreachable while processing deviceInfo
</failure>
</testcase>
"""
STARTUP = """\
iOS driver not ready in time, consider increasing timeout by configuring MAESTRO_DRIVER_STARTUP_TIMEOUT env variable
xcuitest.installer.LocalXCTestInstaller$IOSDriverTimeoutException: iOS driver not ready in time
"""
SERVER_ERROR = "maestro.utils.network.XCUITestServerError$Unreachable: Transport unreachable\n"
ASSERTION = """\
<testcase id="Share a photo" status="ERROR">
  <failure>Assertion is false: "Task title" is visible</failure>
</testcase>
"""
ANDROID_DEVICE_CALL = """\
<testcase id="Sign in and see the board" status="ERROR">
  <failure>maestro.android.DeviceCallFailedException: 'deviceInfo' failed: INTERNAL - error in frame handler
\tat maestro.android.AndroidDeviceConnectionModelKt.orThrow(AndroidDeviceConnectionModel.kt:79)
\tat maestro.drivers.AndroidDriver.deviceInfo(AndroidDriver.kt:205)
</failure>
</testcase>
"""
PASSED = '<testcase id="Share a photo" status="SUCCESS"/>\n'


class DriverFailedTest(unittest.TestCase):

    def run_on(self, *contents):
        """Runs the script on one file per content; returns its exit status."""
        with tempfile.TemporaryDirectory() as work:
            files = []
            for n, content in enumerate(contents):
                path = pathlib.Path(work) / f"file-{n}"
                path.write_text(content)
                files.append(str(path))
            return subprocess.run(["bash", str(SCRIPT), *files], capture_output=True).returncode

    def test_the_driver_going_away_mid_flow(self):
        self.assertEqual(self.run_on(PASSED.replace("SUCCESS", "ERROR"), UNREACHABLE), 0)

    def test_the_driver_not_starting_in_time(self):
        self.assertEqual(self.run_on(STARTUP), 0)

    def test_the_driver_server_unreachable(self):
        self.assertEqual(self.run_on(SERVER_ERROR), 0)

    def test_the_android_driver_failing_a_call(self):
        self.assertEqual(self.run_on("[Failed] Sign in and see the board (183ms)\n", ANDROID_DEVICE_CALL), 0)

    def test_a_failed_check_is_the_flows(self):
        self.assertEqual(self.run_on("[Failed] Share a photo (2m 36s)\n", ASSERTION), 1)

    def test_a_passed_flow(self):
        self.assertEqual(self.run_on(PASSED), 1)

    def test_a_file_that_is_missing_is_no_driver_failure(self):
        # Maestro writes no report when it never got going; its console output still says why.
        self.assertEqual(self.run_on(), 1)
        self.assertEqual(subprocess.run(["bash", str(SCRIPT), "/nonexistent/report.xml"],
                                        capture_output=True).returncode, 1)


if __name__ == "__main__":
    unittest.main()
