"""
Pins down how the site shows a link that leaves it (#644): it opens in a new tab, says so to a
screen reader, and carries the class the stylesheet puts a ↗ after -- unless the link is only an
image, such as a badge, where an arrow would hang beside the picture. A link to one of the site's
own pages, relative or absolute, stays as it is.

Run with:  python3 -m unittest discover -s .github/scripts -p 'test_*.py'
"""

import importlib.util
import pathlib
import unittest

_spec = importlib.util.spec_from_file_location("build_site", pathlib.Path(__file__).with_name("build-site.py"))
site = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(site)

NEW_TAB = '<span class="visually-hidden"> (opens in a new tab)</span>'


class ExternalLinkTest(unittest.TestCase):

    def test_opens_a_link_to_another_site_in_a_new_tab_and_marks_it(self):
        self.assertEqual(
            f'<a href="https://go.dev" class="external" target="_blank" rel="noopener">Go{NEW_TAB}</a>',
            site.mark_external_links('<a href="https://go.dev">Go</a>'),
        )

    def test_treats_a_file_on_github_as_another_site(self):
        self.assertIn(
            'class="external"',
            site.mark_external_links(f'<a href="{site.REPO_URL}/blob/main/LICENSE">LICENSE</a>'),
        )

    def test_leaves_a_link_within_the_site_alone(self):
        rendered = '<a href="../doc/purpose.html">purpose</a> <a href="#about-me">About me</a>'
        self.assertEqual(rendered, site.mark_external_links(rendered))

    def test_leaves_an_absolute_link_to_the_site_itself_alone(self):
        rendered = f'<a href="{site.SITE_URL}doc/">the documentation</a>'
        self.assertEqual(rendered, site.mark_external_links(rendered))

    def test_opens_an_image_link_in_a_new_tab_without_the_arrow(self):
        self.assertEqual(
            f'<a href="https://sonarcloud.io" target="_blank" rel="noopener"><img src="badge.svg" alt="Quality">{NEW_TAB}</a>',
            site.mark_external_links('<a href="https://sonarcloud.io"><img src="badge.svg" alt="Quality"></a>'),
        )

    def test_adds_to_a_class_the_link_already_has(self):
        self.assertEqual(
            f'<a class="card external" href="https://go.dev" target="_blank" rel="noopener">Go{NEW_TAB}</a>',
            site.mark_external_links('<a class="card" href="https://go.dev">Go</a>'),
        )

    def test_leaves_a_link_that_already_chooses_its_target_alone(self):
        rendered = '<a href="https://go.dev" target="_self">Go</a>'
        self.assertEqual(rendered, site.mark_external_links(rendered))

    def test_marks_the_links_of_every_page_masthead_and_footer_included(self):
        rendered = site.page(
            title="t", description="d", depth=1, current="doc", body='<a href="https://go.dev">Go</a>'
        )
        self.assertIn('<a href="https://go.dev" class="external" target="_blank" rel="noopener">', rendered)
        self.assertIn(f'<a href="{site.REPO_URL}" class="external" target="_blank" rel="noopener">', rendered)


if __name__ == "__main__":
    unittest.main()
