"""
Pins down google-client-ids.py: a mobile release takes the variant's Google client ids from that
environment's terraform.tfvars, the ids its backend accepts, so that the app and the backend
cannot disagree about them (#607).

Run with:  python3 -m unittest discover -s .github/scripts -p 'test_*.py'
"""

import pathlib
import subprocess
import tempfile
import unittest

SCRIPT = pathlib.Path(__file__).with_name("google-client-ids.py")
ROOT = SCRIPT.parents[2]


def ids(variant, tfvars=None):
    args = ["python3", str(SCRIPT), variant] + ([str(tfvars)] if tfvars else [])
    return subprocess.run(args, capture_output=True, text=True, cwd=ROOT)


class GoogleClientIdsTest(unittest.TestCase):

    def test_names_the_variant_s_web_and_ios_clients_for_github_env(self):
        with tempfile.TemporaryDirectory() as directory:
            tfvars = pathlib.Path(directory, "terraform.tfvars")
            tfvars.write_text(
                '# A comment: google_client_id = "not-this"\n'
                'google_client_id = "1-web.apps.googleusercontent.com"\n'
                'google_ios_client_id  =  "1-ios.apps.googleusercontent.com" # trailing\n'
            )
            result = ids("qa", tfvars)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout.splitlines(), [
            "TASKFEST_QA_GOOGLE_WEB_CLIENT_ID=1-web.apps.googleusercontent.com",
            "TASKFEST_QA_GOOGLE_IOS_CLIENT_ID=1-ios.apps.googleusercontent.com",
        ])

    def test_skips_an_id_in_a_block_comment(self):
        with tempfile.TemporaryDirectory() as directory:
            tfvars = pathlib.Path(directory, "terraform.tfvars")
            tfvars.write_text('google_client_id = "current-web"\n/*\ngoogle_client_id = "retired-web"\n*/\n')
            result = ids("qa", tfvars)
        self.assertEqual(result.stdout.splitlines(), ["TASKFEST_QA_GOOGLE_WEB_CLIENT_ID=current-web"])

    def test_leaves_out_an_id_the_environment_does_not_have(self):
        # The release's settings check then names it, as for any setting missing.
        with tempfile.TemporaryDirectory() as directory:
            tfvars = pathlib.Path(directory, "terraform.tfvars")
            tfvars.write_text('google_client_id = ""\ngoogle_ios_client_id = "1-ios"\n')
            result = ids("prod", tfvars)
        self.assertEqual(result.stdout.splitlines(), ["TASKFEST_PROD_GOOGLE_IOS_CLIENT_ID=1-ios"])

    def test_reads_each_environment_s_own_file_by_default(self):
        for variant in ("qa", "prod"):
            result = ids(variant)
            self.assertEqual(result.returncode, 0, result.stderr)
            prefix = f"TASKFEST_{variant.upper()}_GOOGLE_"
            self.assertEqual([line.split("=")[0] for line in result.stdout.splitlines()],
                             [prefix + "WEB_CLIENT_ID", prefix + "IOS_CLIENT_ID"])

    def test_refuses_a_variant_without_an_environment(self):
        self.assertEqual(ids("dev").returncode, 2)


if __name__ == "__main__":
    unittest.main()
