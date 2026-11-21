"""
Pins down what the landing page's hero carries besides the project (#646): Gunnar's photo and,
beneath it, "My contribution", both leading to the page he writes himself.

Run with:  python3 -m unittest discover -s .github/scripts -p 'test_*.py'
"""

import importlib.util
import pathlib
import tempfile
import unittest

_spec = importlib.util.spec_from_file_location("build_site", pathlib.Path(__file__).with_name("build-site.py"))
site = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(site)


class LandingTest(unittest.TestCase):

    @classmethod
    def setUpClass(cls):
        with tempfile.TemporaryDirectory() as directory:
            site.build_landing(pathlib.Path(directory), [("main", "main")])
            cls.landing = (pathlib.Path(directory) / "index.html").read_text()

    def test_leads_from_the_photo_and_its_caption_to_gunnars_page(self):
        self.assertIn(
            '<a class="hero__author" href="doc/message-from-gunnar.html">'
            '<img src="doc/images/gunnar-hilling.jpg" alt="Gunnar Hilling" width="128" height="160">'
            "<span>My contribution</span></a>",
            self.landing,
        )

    def test_keeps_the_photo_beside_the_project_in_the_hero(self):
        hero = self.landing[self.landing.index('<div class="hero">'):self.landing.index('<div class="cards">')]
        self.assertIn("<h1>", hero)
        self.assertIn('class="hero__author"', hero)


if __name__ == "__main__":
    unittest.main()
