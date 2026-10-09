"""
Pins down check-image-platforms.py: which architectures a pushed tag's image index lists, compared
with what the workflow built (#249). Without a registry: the index is passed as the JSON
`docker buildx imagetools inspect --format '{{json .Manifest}}'` prints.

Run with:  python3 -m unittest discover -s .github/scripts -p 'test_*.py'
"""

import importlib.util
import pathlib
import unittest

_spec = importlib.util.spec_from_file_location(
    "check_image_platforms", pathlib.Path(__file__).with_name("check-image-platforms.py"))
check = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(check)

INDEX = {"manifests": [
    {"platform": {"os": "linux", "architecture": "amd64"}},
    {"platform": {"os": "linux", "architecture": "arm64"}},
    # buildx's attestations, which are no platform anyone runs.
    {"platform": {"os": "unknown", "architecture": "unknown"}},
]}


class CheckTest(unittest.TestCase):

    def test_an_index_with_every_platform_built_passes(self):
        self.assertEqual(check.missing(INDEX, "linux/amd64,linux/arm64"), [])

    def test_a_platform_the_index_lacks_is_named(self):
        self.assertEqual(check.missing(INDEX, "linux/amd64,linux/arm64,linux/s390x"), ["linux/s390x"])

    def test_a_single_image_rather_than_an_index_lacks_everything_but_its_own(self):
        single = {"mediaType": "application/vnd.oci.image.manifest.v1+json", "config": {}}
        self.assertEqual(check.missing(single, "linux/amd64,linux/arm64"), ["linux/amd64", "linux/arm64"])

    def test_a_variant_in_the_list_is_matched_by_os_and_architecture(self):
        self.assertEqual(check.missing(INDEX, "linux/arm64/v8"), [])


if __name__ == "__main__":
    unittest.main()
