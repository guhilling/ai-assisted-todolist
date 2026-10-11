"""
Pins down which emulator and system image revisions android-revisions.py reads from Google's
package index (#302), without the network.

The packages below are taken from repository2-3.xml and sys-img/google_apis/sys-img2-3.xml as of
11 October 2026, their archives left out.

Run with:  python3 -m unittest discover -s .github/scripts -p 'test_*.py'
"""

import importlib.util
import pathlib
import unittest

_spec = importlib.util.spec_from_file_location(
    "android_revisions", pathlib.Path(__file__).with_name("android-revisions.py"))
revisions = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(revisions)

ROOT = ('<sdk:sdk-repository xmlns:sdk="http://schemas.android.com/sdk/android/repo/repository2/03"'
        ' xmlns:generic="http://schemas.android.com/repository/android/generic/02"'
        ' xmlns:sys-img="http://schemas.android.com/sdk/android/repo/sys-img2/03"'
        ' xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">%s</sdk:sdk-repository>')


def emulator(major, minor, micro, channel):
    return f"""
  <remotePackage path="emulator">
    <type-details xsi:type="generic:genericDetailsType"/>
    <revision><major>{major}</major><minor>{minor}</minor><micro>{micro}</micro></revision>
    <display-name>Android Emulator</display-name>
    <channelRef ref="{channel}"/>
  </remotePackage>"""


SYSTEM_IMAGE = """
  <remotePackage path="system-images;android-34;google_apis;x86_64">
    <type-details xsi:type="sys-img:sysImgDetailsType">
      <api-level>34</api-level>
      <tag><id>google_apis</id><display>Google APIs</display></tag>
      <abi>x86_64</abi>
    </type-details>
    <revision><major>14</major></revision>
    <display-name>Google APIs Intel x86_64 Atom System Image</display-name>
    <dependencies>
      <dependency path="emulator">
        <min-revision><major>34</major><minor>2</minor><micro>16</micro></min-revision>
      </dependency>
    </dependencies>
    <channelRef ref="channel-0"/>
  </remotePackage>"""


class NewestTest(unittest.TestCase):

    def test_the_stable_channel_only(self):
        index = ROOT % (emulator(37, 3, 3, "channel-2") + emulator(37, 2, 12, "channel-0"))
        self.assertEqual(revisions.newest(index, "emulator"), "37.2.12")

    def test_the_highest_revision_by_number(self):
        index = ROOT % (emulator(36, 10, 1, "channel-0") + emulator(36, 9, 30, "channel-0"))
        self.assertEqual(revisions.newest(index, "emulator"), "36.10.1")

    def test_a_package_without_a_channel_is_stable(self):
        index = ROOT % emulator(37, 2, 12, "channel-0").replace('<channelRef ref="channel-0"/>', "")
        self.assertEqual(revisions.newest(index, "emulator"), "37.2.12")

    def test_a_system_images_own_revision_not_its_dependencys(self):
        index = ROOT % SYSTEM_IMAGE
        self.assertEqual(revisions.newest(index, "system-images;android-34;google_apis;x86_64"), "14")

    def test_a_package_the_index_lacks_is_an_error(self):
        with self.assertRaises(LookupError):
            revisions.newest(ROOT % SYSTEM_IMAGE, "emulator")


class IndexTest(unittest.TestCase):

    def test_the_emulator_is_in_the_main_repository(self):
        self.assertTrue(revisions.index_url("emulator").endswith("/repository2-3.xml"))

    def test_a_system_image_is_in_its_tags_index(self):
        self.assertTrue(revisions.index_url("system-images;android-34;google_apis;x86_64")
                        .endswith("/sys-img/google_apis/sys-img2-3.xml"))


if __name__ == "__main__":
    unittest.main()
