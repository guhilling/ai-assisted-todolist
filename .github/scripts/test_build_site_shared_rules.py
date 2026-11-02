"""
Pins down how the site shows the shared rules (#471): rules.md from dev-conventions, fetched at the
tag .claude/settings.json pins, rendered next to the CLAUDE.md files and saying where it comes
from -- so a Renovate bump of the pin is all it takes to change what the site shows.

Run with:  python3 -m unittest discover -s .github/scripts -p 'test_*.py'
"""

import importlib.util
import json
import pathlib
import shutil
import tempfile
import unittest

_spec = importlib.util.spec_from_file_location(
    "build_site", pathlib.Path(__file__).with_name("build-site.py"))
site = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(site)

DEV_CONVENTIONS = "guhilling/dev-conventions/blob/v9.8.7/plugins/conventions"
RULES = "# Shared working conventions\n\nAsk, don't guess. See [the plugin](README.md).\n"


def settings_pinning(directory: pathlib.Path, ref: str) -> pathlib.Path:
    """A settings file like .claude/settings.json, with the marketplace pinned to `ref`."""
    path = directory / "settings.json"
    path.write_text(json.dumps({"extraKnownMarketplaces": {"dev-conventions": {
        "source": {"source": "github", "repo": "guhilling/dev-conventions", "ref": ref}}}}))
    return path


class SharedRulesTest(unittest.TestCase):

    def setUp(self):
        self.directory = pathlib.Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.directory)

    def build(self, ref: str = "v1.3.0", text: str = RULES) -> str:
        source = site.shared_rules_source(settings_pinning(self.directory, ref))
        site.build_shared_rules(self.directory / "_site", [], text, source)
        return (self.directory / "_site" / "instructions" / "shared.html").read_text()

    def test_fetches_the_rules_at_the_tag_the_settings_pin(self):
        source = site.shared_rules_source(settings_pinning(self.directory, "v9.8.7"))
        self.assertEqual(
            "https://raw.githubusercontent.com/guhilling/dev-conventions/v9.8.7/"
            "plugins/conventions/rules.md",
            source.raw_url,
        )

    def test_renders_the_rules_as_an_instructions_page(self):
        self.assertIn(
            '<h1 id="shared-working-conventions">Shared working conventions', self.build())

    def test_says_which_repository_and_tag_the_rules_come_from(self):
        page = self.build("v9.8.7")
        self.assertIn(
            f'href="https://github.com/{DEV_CONVENTIONS}/rules.md"',
            page,
        )
        self.assertIn("v9.8.7", page)
        self.assertIn(".claude/settings.json", page)

    def test_points_a_relative_link_into_dev_conventions_at_the_tag(self):
        self.assertIn(
            f'href="https://github.com/{DEV_CONVENTIONS}/README.md"',
            self.build("v9.8.7"),
        )

    def test_lists_the_shared_rules_among_the_instructions(self):
        sidebar = site.sidebar([], "instructions", "shared", 1)
        self.assertIn(
            '<a href="../instructions/shared.html" aria-current="page">Shared rules</a>', sidebar)
        self.assertLess(sidebar.index("Repository"), sidebar.index("Shared rules"))
        self.assertLess(sidebar.index("Shared rules"), sidebar.index("Backend"))

    def test_stops_the_build_when_the_rules_cannot_be_fetched(self):
        def unreachable(url, timeout):
            raise OSError("no route to host")

        source = site.shared_rules_source(settings_pinning(self.directory, "v1.3.0"))
        with self.assertRaises(SystemExit) as stopped:
            site.fetch_shared_rules(source, opener=unreachable, pause=0)
        self.assertIn(source.raw_url, str(stopped.exception))

    def test_reads_the_pin_this_repository_has(self):
        source = site.shared_rules_source(site.SETTINGS)
        self.assertEqual("guhilling/dev-conventions", source.repo)
        self.assertRegex(source.ref, r"^v\d+\.\d+\.\d+$")


    def test_points_a_link_to_the_repository_itself_at_its_root(self):
        self.assertIn(
            'href="https://github.com/guhilling/dev-conventions/tree/v9.8.7/"',
            self.build("v9.8.7", "See [dev-conventions](../../).\n"),
        )

    def test_stops_the_build_on_a_link_out_of_dev_conventions(self):
        with self.assertRaises(SystemExit):
            self.build(text="See [that](../../../elsewhere.md).\n")

    def test_stops_the_build_on_an_image_a_browser_would_fetch_from_github(self):
        with self.assertRaises(SystemExit):
            self.build(text="![a diagram](images/flow.svg)\n")

    def test_stops_the_build_on_a_block_its_list_would_lose(self):
        with self.assertRaises(SystemExit):
            self.build(text="1. Run it:\n\n   ```bash\n   make\n   ```\n")

    def test_tries_again_after_a_failed_fetch(self):
        answers = [OSError("reset by peer"), b"# Rules\n"]

        class Answer:
            def __init__(self, body):
                self.body = body

            def __enter__(self):
                return self

            def __exit__(self, *args):
                return False

            def read(self):
                return self.body

        def flaky(url, timeout):
            answer = answers.pop(0)
            if isinstance(answer, Exception):
                raise answer
            return Answer(answer)

        source = site.shared_rules_source(settings_pinning(self.directory, "v1.3.0"))
        self.assertEqual("# Rules\n", site.fetch_shared_rules(source, opener=flaky, pause=0))

    def test_stops_the_build_on_empty_rules(self):
        with self.assertRaises(SystemExit):
            self.build(text="  \n")

    def test_stops_the_build_on_an_image_from_anywhere(self):
        for text in ("![a diagram](https://example.com/flow.svg)\n",
                     '<IMG SRC="https://example.com/flow.svg">\n'):
            with self.subTest(text=text), self.assertRaises(SystemExit):
                self.build(text=text)

if __name__ == "__main__":
    unittest.main()
