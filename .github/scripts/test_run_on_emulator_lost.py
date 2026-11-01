"""
Pins down what mobile/maestro/run-on-emulator.sh does when a flow loses its emulator (#461): it
stops there, without running the flow again on an emulator that is gone, and leaves
emulator-lost.txt naming the flow, for Mobile CI to run the share once more on a freshly booted
one. A flow that fails by itself, or through Maestro's driver, leaves no such file.
test_run_on_emulator.py has the in-place retry after a driver failure (#445).

Each test runs a copy of the script beside the real driver-failed.sh and emulator-lost.sh, with
stand-ins for emulator-ready.sh, adb and maestro, so no emulator is needed.

Run with:  python3 -m unittest discover -s .github/scripts -p 'test_*.py'
"""

import os
import pathlib
import shutil
import subprocess
import tempfile
import unittest

# The stand-ins test_run_on_emulator.py runs the script with, shared rather than copied.
from test_run_on_emulator import ADB, DRIVER_FAILED, EMULATOR_READY, MAESTRO, MAESTRO_DIR

NOT_FOUND = ("java.io.IOException: Command failed (host:transport:emulator-5554): "
             "device 'emulator-5554' not found")


@unittest.skipUnless(shutil.which("bash"), "needs bash")
class EmulatorLostTest(unittest.TestCase):

    def setUp(self):
        self.work = tempfile.TemporaryDirectory()
        work = pathlib.Path(self.work.name)
        scripts = work / "maestro"
        scripts.mkdir()
        for name in ("run-on-emulator.sh", "driver-failed.sh", "emulator-lost.sh"):
            shutil.copy(MAESTRO_DIR / name, scripts / name)
        (scripts / "emulator-ready.sh").write_text(EMULATOR_READY)
        bin_dir = work / "bin"
        bin_dir.mkdir()
        for name, script in (("adb", ADB), ("maestro", MAESTRO)):
            (bin_dir / name).write_text(script)
            (bin_dir / name).chmod(0o755)
        self.runs = work / "runs"
        self.lost = work / "emulator-lost.txt"
        self.env = {"PATH": f"{bin_dir}:{os.environ['PATH']}", "MAESTRO_RUNS": str(self.runs)}

    def tearDown(self):
        self.work.cleanup()

    def run_flows(self, maestro_says):
        """Runs the `others` share, whose first flow fails; returns its exit status and Maestro's runs."""
        result = subprocess.run(
            ["bash", str(pathlib.Path(self.work.name) / "maestro" / "run-on-emulator.sh"), "app.apk", "others"],
            cwd=self.work.name, env={**self.env, "MAESTRO_SAYS": maestro_says},
            capture_output=True, text=True, timeout=60)
        return result.returncode, len(self.runs.read_text().splitlines())

    def test_a_flow_that_lost_its_emulator_stops_there_and_says_so(self):
        self.assertEqual(self.run_flows(NOT_FOUND), (1, 1))
        self.assertIn("mobile/maestro/account.yaml", self.lost.read_text())

    def test_a_flow_that_fails_by_itself_leaves_no_word_of_a_lost_emulator(self):
        self.assertEqual(self.run_flows('Assertion is false: "Account" is visible'), (1, 1))
        self.assertFalse(self.lost.exists())

    def test_a_flow_whose_driver_failed_leaves_no_word_of_a_lost_emulator(self):
        self.assertEqual(self.run_flows(DRIVER_FAILED), (1, 2))
        self.assertFalse(self.lost.exists())


if __name__ == "__main__":
    unittest.main()
