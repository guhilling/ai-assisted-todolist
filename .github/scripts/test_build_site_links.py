"""
Pins down where a link in the documents leads on the site: a page of doc/ to its page, and the
root README, which is the site's landing page, to that landing page rather than to GitHub.

Run with:  python3 -m unittest discover -s .github/scripts -p 'test_*.py'
"""

import importlib.util
import pathlib
import unittest

_spec = importlib.util.spec_from_file_location("build_site", pathlib.Path(__file__).with_name("build-site.py"))
site = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(site)


class LinkTest(unittest.TestCase):

    def test_leads_a_document_to_its_page(self):
        self.assertEqual(
            '<a href="../doc/purpose.html">', site.retarget_links('<a href="purpose.md">', base="doc", depth=1)
        )

    def test_leads_the_root_readme_to_the_landing_page(self):
        self.assertEqual(
            '<a href="../index.html">', site.retarget_links('<a href="../README.md">', base="doc", depth=1)
        )

    def test_keeps_a_fragment_on_the_landing_page(self):
        self.assertEqual(
            '<a href="../index.html#what-it-is">',
            site.retarget_links('<a href="../README.md#what-it-is">', base="doc", depth=1),
        )


if __name__ == "__main__":
    unittest.main()
