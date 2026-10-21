"""
Pins down what check-share-extension.py counts as a share extension built or signed wrongly (#356):
the name the share sheet shows, the App Group the extension and the app share, and that a signed
build still carries it.

Run with:  python3 -m unittest discover -s .github/scripts -p 'test_*.py'
"""

import importlib.util
import pathlib
import unittest

_spec = importlib.util.spec_from_file_location(
    "check_share_extension", pathlib.Path(__file__).with_name("check-share-extension.py"))
check = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(check)

APP = {"CFBundleIdentifier": "de.hilling.taskfest.qa"}
EXTENSION = {
    "CFBundleDisplayName": "TaskFest QA",
    "AppGroupId": "group.de.hilling.taskfest.qa",
    "NSExtension": {"NSExtensionPointIdentifier": "com.apple.share-services"},
}
GROUPS = {"com.apple.security.application-groups": ["group.de.hilling.taskfest.qa"]}


class Built(unittest.TestCase):
    def test_an_extension_as_generated_passes(self):
        self.assertEqual(check.built_problems(APP, EXTENSION, "TaskFest QA"), [])

    def test_no_extension_fails(self):
        self.assertEqual(check.built_problems(APP, None, "TaskFest QA"),
                         ["The app embeds no PlugIns/expo-sharing-extension.appex."])

    def test_the_targets_name_fails(self):
        named = {**EXTENSION, "CFBundleDisplayName": "$(PRODUCT_NAME)"}
        self.assertEqual(check.built_problems(APP, named, "TaskFest QA"),
                         ["The share sheet would say '$(PRODUCT_NAME)', not 'TaskFest QA'."])

    def test_another_app_group_fails(self):
        grouped = {**EXTENSION, "AppGroupId": "group.de.hilling.taskfest"}
        self.assertEqual(check.built_problems(APP, grouped, "TaskFest QA"),
                         ["The extension uses App Group 'group.de.hilling.taskfest', "
                          "not 'group.de.hilling.taskfest.qa'."])

    def test_another_kind_of_extension_fails(self):
        other = {**EXTENSION, "NSExtension": {"NSExtensionPointIdentifier": "com.apple.widgetkit-extension"}}
        self.assertEqual(check.built_problems(APP, other, "TaskFest QA"),
                         ["The extension is a com.apple.widgetkit-extension, not a share extension."])


class Signed(unittest.TestCase):
    def test_both_with_the_app_group_pass(self):
        self.assertEqual(check.signed_problems("de.hilling.taskfest.qa", GROUPS, GROUPS), [])

    def test_an_app_signed_without_it_fails(self):
        self.assertEqual(check.signed_problems("de.hilling.taskfest.qa", {}, GROUPS),
                         ["The app is signed without App Group group.de.hilling.taskfest.qa."])

    def test_an_extension_signed_without_it_fails(self):
        self.assertEqual(check.signed_problems("de.hilling.taskfest.qa", GROUPS, {}),
                         ["The share extension is signed without App Group group.de.hilling.taskfest.qa."])

    def test_no_extension_fails(self):
        self.assertEqual(check.signed_problems("de.hilling.taskfest.qa", GROUPS, None),
                         ["The app embeds no PlugIns/expo-sharing-extension.appex."])


if __name__ == "__main__":
    unittest.main()
