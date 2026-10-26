"""
Pins down how the site renders the documents' Markdown: a code block inside a numbered step stays
a code block, line by line, as it does at the top of a page -- and a block indented the way GitHub
would accept but Python-Markdown would quietly take out of its list stops the build instead.

Run with:  python3 -m unittest discover -s .github/scripts -p 'test_*.py'
"""

import importlib.util
import pathlib
import tempfile
import unittest

_spec = importlib.util.spec_from_file_location("build_site", pathlib.Path(__file__).with_name("build-site.py"))
site = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(site)


class MarkdownTest(unittest.TestCase):

    def test_keeps_a_code_block_inside_a_numbered_step_line_by_line(self):
        html = site.renderer().convert(
            "1. **The upload key.** One key serves both apps:\n"
            "\n"
            "    ```bash\n"
            "    keytool -genkeypair -alias upload \\\n"
            "      -keyalg RSA\n"
            "    base64 -i taskfest-upload.jks | pbcopy\n"
            "    ```\n"
            "\n"
            "2. **Google Cloud.**\n"
        )
        self.assertIn(
            "<p><strong>The upload key.</strong> One key serves both apps:</p>\n"
            "<pre class=\"highlight\"><code class=\"language-bash\">keytool -genkeypair -alias upload \\\n"
            "  -keyalg RSA\n"
            "base64 -i taskfest-upload.jks | pbcopy</code></pre>\n"
            "</li>",
            html,
        )
        self.assertNotIn("<ol start=", html)

    def test_keeps_a_code_block_at_the_top_of_a_page_as_it_was(self):
        html = site.renderer().convert("```sh\ntofu apply\n```\n")
        self.assertIn("<pre class=\"highlight\"><code class=\"language-sh\">tofu apply</code></pre>", html)

    def test_names_every_block_in_a_list_indented_less_than_python_markdown_needs(self):
        text = (
            "Intro.\n"
            "\n"
            "1. Step:\n"
            "\n"
            "   ```bash\n"
            "   keytool\n"
            "   ```\n"
            "\n"
            "   It asks for one password.\n"
            "\n"
            "- Point:\n"
            "\n"
            "    Indented enough.\n"
            "\n"
            "```sh\n"
            "  indented inside a code block is code\n"
            "```\n"
        )
        self.assertEqual(site.underindented_blocks(text), [5, 9])

    def test_stops_the_build_on_a_block_its_list_would_lose(self):
        with tempfile.TemporaryDirectory() as tmp:
            source = pathlib.Path(tmp) / "steps.md"
            source.write_text("1. Step:\n\n   ```bash\n   keytool\n   ```\n")
            with self.assertRaisesRegex(SystemExit, r"steps\.md:3"):
                site.render_markdown(source, base="doc", depth=1)

    def test_finds_no_such_block_in_the_documents(self):
        # The site is built on main only, so this is what tells a pull request.
        root = pathlib.Path(__file__).resolve().parents[2]
        for source in [root / "README.md", *sorted((root / "doc").rglob("*.md"))]:
            with self.subTest(page=str(source.relative_to(root))):
                self.assertEqual(site.underindented_blocks(source.read_text()), [])


if __name__ == "__main__":
    unittest.main()
