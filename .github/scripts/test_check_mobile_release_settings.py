"""
Pins down check-mobile-release-settings.sh: a mobile release build stops at once, naming what is
missing, rather than after twenty minutes of building, when a secret or variable it needs is
unset -- and the qa build needs qa's test accounts besides.

Run with:  python3 -m unittest discover -s .github/scripts -p 'test_*.py'
"""

import pathlib
import subprocess
import unittest

SCRIPT = pathlib.Path(__file__).with_name("check-mobile-release-settings.sh")

ANDROID = {
    "UPLOAD_KEYSTORE": "a2V5", "UPLOAD_KEYSTORE_PASSWORD": "pw", "UPLOAD_KEY_ALIAS": "upload",
    "UPLOAD_KEY_PASSWORD": "pw", "WORKLOAD_IDENTITY_PROVIDER": "projects/1/locations/global/x",
}
IOS = {"APPLE_API_KEY": "-----BEGIN PRIVATE KEY-----", "APPLE_API_KEY_ID": "K", "APPLE_API_ISSUER_ID": "I"}
QA = {"TASKFEST_QA_COGNITO_ISSUER": "https://cognito-idp.example.com/pool", "TASKFEST_QA_APP_CLIENT_ID": "c"}


def check(platform, variant, env):
    return subprocess.run(["bash", str(SCRIPT), platform, variant], env={"PATH": "/usr/bin:/bin", **env},
                          capture_output=True, text=True)


class CheckTest(unittest.TestCase):

    def test_a_complete_android_prod_build_passes(self):
        self.assertEqual(check("android", "prod", ANDROID).returncode, 0)

    def test_a_complete_ios_qa_build_passes(self):
        self.assertEqual(check("ios", "qa", {**IOS, **QA}).returncode, 0)

    def test_names_every_missing_setting_at_once(self):
        result = check("android", "prod", {"UPLOAD_KEYSTORE": "a2V5"})
        self.assertEqual(result.returncode, 1)
        for name in ("ANDROID_UPLOAD_KEYSTORE_PASSWORD", "ANDROID_UPLOAD_KEY_ALIAS",
                     "ANDROID_UPLOAD_KEY_PASSWORD", "GOOGLE_WORKLOAD_IDENTITY_PROVIDER"):
            self.assertIn(name, result.stdout)
        self.assertNotIn("ANDROID_UPLOAD_KEYSTORE ", result.stdout)

    def test_the_qa_build_needs_its_test_accounts(self):
        result = check("ios", "qa", IOS)
        self.assertEqual(result.returncode, 1)
        self.assertIn("TASKFEST_QA_COGNITO_ISSUER", result.stdout)
        self.assertIn("TASKFEST_QA_APP_CLIENT_ID", result.stdout)

    def test_the_prod_build_does_not(self):
        self.assertEqual(check("ios", "prod", IOS).returncode, 0)

    def test_refuses_a_platform_it_does_not_know(self):
        self.assertEqual(check("windows", "prod", {}).returncode, 2)


if __name__ == "__main__":
    unittest.main()
