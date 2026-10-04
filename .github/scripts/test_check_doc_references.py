"""
Pins down what check-doc-references.py counts as a reference to the documentation, and when one
is dead.

The site build already fails on a dead link between pages. What it cannot see is a code comment,
a CLAUDE.md or an OpenTofu file naming `doc/...` in prose -- and splitting the long documents
into chapters moved 47 of those at once. This is the check that would have caught any missed.

Run with:  python3 -m unittest discover -s .github/scripts -p 'test_*.py'
"""

import importlib.util
import pathlib
import unittest

_spec = importlib.util.spec_from_file_location(
    "check_doc_references", pathlib.Path(__file__).with_name("check-doc-references.py"))
check = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(check)


class FindReferencesTest(unittest.TestCase):

    def test_a_document_named_in_a_code_comment(self):
        text = "see {@code doc/decisions/authentication.md}.</p>"
        self.assertEqual(check.references(text), ["doc/decisions/authentication.md"])

    def test_a_chapter_named_by_its_directory(self):
        self.assertEqual(check.references("`doc/deployment/` is the plan"), ["doc/deployment/"])

    def test_several_on_one_line_and_in_markdown_links(self):
        text = "[a](doc/testing/index.md) and doc/releasing.md, then (doc/deployment/cost.md)."
        self.assertEqual(check.references(text),
                         ["doc/testing/index.md", "doc/releasing.md", "doc/deployment/cost.md"])

    def test_a_longer_path_that_merely_ends_in_doc_is_not_a_reference(self):
        self.assertEqual(check.references("backend/doc/notes.md and frontend-doc/x.md"), [])

    def test_the_bare_folder_and_generated_files_are_not_checked_as_documents(self):
        self.assertEqual(check.references("everything under doc/api/openapi.yaml, in doc/"), [])


class DeadReferencesTest(unittest.TestCase):

    def test_an_existing_document_and_chapter_are_fine(self):
        exists = {"doc/testing/index.md", "doc/deployment"}.__contains__
        self.assertEqual(check.dead(["doc/testing/index.md", "doc/deployment/"], exists), [])

    def test_a_moved_document_is_dead(self):
        # Assembled, so this file does not name a dead path itself and fail the check it tests.
        moved = "doc/" + "decisions.md"
        exists = {"doc/decisions/index.md"}.__contains__
        self.assertEqual(check.dead([moved], exists), [moved])


if __name__ == "__main__":
    unittest.main()
