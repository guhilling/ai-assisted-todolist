"""
Pins down what the landing page's hero carries besides the project (#646): Gunnar's photo and,
beneath it, "My contribution", both leading to the page he writes himself.

Run with:  python3 -m unittest discover -s .github/scripts -p 'test_*.py'
"""

import importlib.util
import pathlib
import re
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
        author = re.search(r'<a class="hero__author" href="([^"]*)">(.*?)</a>', self.landing, re.DOTALL)
        self.assertIsNotNone(author)
        self.assertEqual("doc/message-from-gunnar.html", author.group(1))
        self.assertRegex(author.group(2), r'<img src="doc/images/gunnar-hilling.jpg" alt="Gunnar Hilling"')
        self.assertIn("<span>My contribution</span>", author.group(2))

    def test_puts_the_photo_after_the_project_not_inside_it(self):
        hero = self.landing[self.landing.index('<div class="hero">'):self.landing.index('<div class="cards">')]
        self.assertRegex(hero, r'(?s)<div class="hero__project">.*?<h1>.*?</div>\s*<a class="hero__author"')


if __name__ == "__main__":
    unittest.main()
