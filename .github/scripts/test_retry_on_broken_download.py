"""
Pins down retry-on-broken-download.sh: a Jib build is tried again when, and only when, a download
from the registry broke off. Quay ended the base image's download early twice on 11 October 2026,
and Jib has no setting to retry it.

Each test hands the script a stand-in command that counts its runs in a file and fails as told.

Run with:  python3 -m unittest discover -s .github/scripts -p 'test_*.py'
"""

import pathlib
import subprocess
import tempfile
import unittest

SCRIPT = pathlib.Path(__file__).with_name("retry-on-broken-download.sh")
BROKEN = "org.apache.http.ConnectionClosedException: Premature end of Content-Length delimited message body"

# Fails with the given lines for as many runs as there are, then succeeds.
STAND_IN = """\
#!/usr/bin/env bash
runs=$(( $(cat "$COUNT" 2>/dev/null || echo 0) + 1 ))
echo "$runs" > "$COUNT"
failure=$(sed -n "${runs}p" "$FAILURES")
if [[ -n "$failure" ]]; then
  echo "[ERROR] ${failure#*|}"
  exit "${failure%%|*}"
fi
echo "BUILD SUCCESS"
"""


class RetryTest(unittest.TestCase):

    def run_with(self, *failures):
        """Runs the script on the stand-in, failing once per (status, line); returns result and runs."""
        with tempfile.TemporaryDirectory() as work:
            work = pathlib.Path(work)
            command = work / "build"
            command.write_text(STAND_IN)
            command.chmod(0o755)
            (work / "failures").write_text("".join(f"{status}|{line}\n" for status, line in failures))
            result = subprocess.run(
                ["bash", str(SCRIPT), str(command)], capture_output=True, text=True,
                env={"PATH": "/usr/bin:/bin", "COUNT": str(work / "count"), "FAILURES": str(work / "failures")})
            return result, int((work / "count").read_text())

    def test_a_build_that_succeeds_runs_once(self):
        result, runs = self.run_with()
        self.assertEqual((result.returncode, runs), (0, 1))
        self.assertIn("BUILD SUCCESS", result.stdout)

    def test_a_broken_download_is_tried_again(self):
        result, runs = self.run_with((1, BROKEN))
        self.assertEqual((result.returncode, runs), (0, 2))

    def test_another_failure_is_not_tried_again_and_keeps_its_status(self):
        result, runs = self.run_with((3, "Tests run: 12, Failures: 1"))
        self.assertEqual((result.returncode, runs), (3, 1))

    def test_it_gives_up_after_three_runs(self):
        result, runs = self.run_with((1, BROKEN), (1, BROKEN), (1, BROKEN), (1, BROKEN))
        self.assertEqual((result.returncode, runs), (1, 3))

    def test_the_build_s_output_is_shown(self):
        result, _ = self.run_with((1, BROKEN))
        self.assertIn(BROKEN, result.stdout)


if __name__ == "__main__":
    unittest.main()
