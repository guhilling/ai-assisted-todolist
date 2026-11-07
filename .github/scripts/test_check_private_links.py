"""
Pins down what check-private-links.py asks of a link to a GitHub repository (#531): one to a
repository that isn't public is followed by ` (private)`, and one to a public repository is not.

GitHub is never asked: the question is a function the tests pass in, and the one that does ask
GitHub gets a stand-in for urlopen.

Run with:  python3 -m unittest discover -s .github/scripts -p 'test_*.py'
"""

import importlib.util
import io
import json
import pathlib
import unittest
import urllib.error
from unittest import mock

_spec = importlib.util.spec_from_file_location(
    "check_private_links", pathlib.Path(__file__).with_name("check-private-links.py"))
check = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(check)

PUBLIC = (200, {"private": False})
PRIVATE = (200, {"private": True})
NOT_FOUND = (404, None)


class Asker:
    """GitHub's answers by repository, recording which repositories it was asked about."""

    def __init__(self, **answers):
        self.answers = {name.replace("__", "/"): answer for name, answer in answers.items()}
        self.asked = []

    def __call__(self, repository):
        self.asked.append(repository)
        return self.answers.get(repository, NOT_FOUND)


def problems(text, ask=None):
    """The problems check-private-links.py finds in one page, `guide/page.md`."""
    return check.problems({"guide/page.md": text}, ask or Asker())


class MarkerTest(unittest.TestCase):

    def test_a_link_to_a_private_repository_without_the_marker(self):
        text = "Intro.\n\nSee [guhilling/monitoring](https://github.com/guhilling/monitoring).\n"
        self.assertEqual(problems(text), [
            ("guide/page.md", 3, "the link to guhilling/monitoring needs ' (private)' after it:"
                                 " the repository is not public (GitHub answered 404)")])

    def test_a_link_to_a_private_repository_with_the_marker(self):
        text = "See [guhilling/monitoring](https://github.com/guhilling/monitoring) (private).\n"
        self.assertEqual(problems(text), [])

    def test_the_marker_may_start_the_next_line(self):
        text = ("See [guhilling/monitoring](https://github.com/guhilling/monitoring)\n"
                "(private), whose\n")
        self.assertEqual(problems(text), [])

    def test_the_marker_is_plain_text_and_follows_at_once(self):
        text = "[a](https://github.com/guhilling/monitoring), (private)\n"
        self.assertEqual(len(problems(text)), 1)

    def test_a_repository_github_says_is_private(self):
        ask = Asker(guhilling__monitoring=PRIVATE)
        self.assertEqual(problems("[a](https://github.com/guhilling/monitoring)\n", ask), [
            ("guide/page.md", 1, "the link to guhilling/monitoring needs ' (private)' after it:"
                                 " the repository is not public (GitHub says it is private)")])

    def test_a_link_to_a_public_repository(self):
        ask = Asker(guhilling__conventions=PUBLIC)
        self.assertEqual(problems("[c](https://github.com/guhilling/conventions)\n", ask), [])

    def test_a_marker_on_a_link_to_a_public_repository_is_stale(self):
        ask = Asker(guhilling__conventions=PUBLIC)
        text = "[c](https://github.com/guhilling/conventions) (private)\n"
        self.assertEqual(problems(text, ask), [
            ("guide/page.md", 1, "the link to guhilling/conventions has ' (private)' after it,"
                                 " but the repository is public")])

    def test_this_repository_is_public_without_asking(self):
        ask = Asker()
        text = "[#508](https://github.com/guhilling/ai-assisted-todolist/issues/508)\n"
        self.assertEqual(problems(text, ask), [])
        self.assertEqual(ask.asked, [])

    def test_a_deep_link_is_a_link_to_its_repository(self):
        text = "[server](https://github.com/guhilling/monitoring/blob/main/doc/server.md)\n"
        self.assertEqual([problem[1] for problem in problems(text)], [1])

    def test_each_repository_is_asked_about_once(self):
        ask = Asker()
        text = ("[a](https://github.com/guhilling/monitoring) (private)\n"
                "[b](https://github.com/guhilling/monitoring/blob/main/x.md) (private)\n"
                "[c](https://github.com/Guhilling/Monitoring.git) (private)\n")
        self.assertEqual(problems(text, ask), [])
        self.assertEqual(ask.asked, ["guhilling/monitoring"])

    def test_every_page_is_checked_and_the_repositories_asked_about_once_in_all(self):
        ask = Asker()
        pages = {"README.md": "[a](https://github.com/guhilling/monitoring)\n",
                 "guide/page.md": "[b](https://github.com/guhilling/monitoring)\n"}
        self.assertEqual([problem[0] for problem in check.problems(pages, ask)],
                         ["README.md", "guide/page.md"])
        self.assertEqual(ask.asked, ["guhilling/monitoring"])


class WhatCountsAsALinkTest(unittest.TestCase):

    def test_an_autolink(self):
        self.assertEqual(problems("<https://github.com/guhilling/monitoring> (private)\n"), [])
        self.assertEqual(len(problems("<https://github.com/guhilling/monitoring>\n")), 1)

    def test_a_bare_url_ends_before_the_punctuation_after_it(self):
        self.assertEqual(problems("At https://github.com/guhilling/monitoring (private).\n"), [])
        self.assertEqual(len(problems("At https://github.com/guhilling/monitoring.\n")), 1)

    def test_a_link_with_a_title(self):
        text = '[a](https://github.com/guhilling/monitoring "The stack") (private)\n'
        self.assertEqual(problems(text), [])

    def test_a_badge_is_marked_after_the_link_around_it(self):
        ask = Asker(guhilling__web=PRIVATE)
        badge = ("[![CI](https://github.com/guhilling/web/actions/workflows/ci.yml/badge.svg)]"
                 "(https://github.com/guhilling/web/actions/workflows/ci.yml)")
        self.assertEqual(problems(badge + " (private)\n", ask), [])
        self.assertEqual(len(problems(badge + "\n", ask)), 1)

    def test_a_github_page_that_is_no_repository(self):
        ask = Asker()
        text = ("[project](https://github.com/users/guhilling/projects/2) (private)\n"
                "[org](https://github.com/orgs/someone/projects/1)\n"
                "[user](https://github.com/guhilling)\n")
        self.assertEqual(problems(text, ask), [])
        self.assertEqual(ask.asked, [])

    def test_the_marker_after_a_link_elsewhere_is_not_checked(self):
        text = "[Play Console](https://play.google.com/console) (private)\n"
        self.assertEqual(problems(text), [])

    def test_a_url_in_a_code_block_is_no_link(self):
        ask = Asker()
        text = ("```\ngit clone https://github.com/guhilling/monitoring\n```\n"
                "~~~\nhttps://github.com/guhilling/monitoring\n~~~\n")
        self.assertEqual(problems(text, ask), [])
        self.assertEqual(ask.asked, [])

    def test_a_url_in_inline_code_is_no_link(self):
        ask = Asker()
        self.assertEqual(problems("Clone `https://github.com/guhilling/monitoring` there.\n", ask),
                         [])
        self.assertEqual(ask.asked, [])

    def test_the_line_counts_the_lines_of_a_code_block(self):
        text = "```\none\ntwo\n```\n[a](https://github.com/guhilling/monitoring)\n"
        self.assertEqual([problem[1] for problem in problems(text)], [5])


class AskGitHubTest(unittest.TestCase):

    @staticmethod
    def answering(body):
        response = mock.MagicMock()
        response.__enter__.return_value.status = 200
        response.__enter__.return_value.read.return_value = json.dumps(body).encode()
        return mock.MagicMock(return_value=response)

    def test_a_public_repository(self):
        urlopen = self.answering({"private": False})
        self.assertEqual(check.ask_github("guhilling/conventions", None, urlopen),
                         (200, {"private": False}))
        request = urlopen.call_args.args[0]
        self.assertEqual(request.full_url, "https://api.github.com/repos/guhilling/conventions")
        self.assertIsNone(request.get_header("Authorization"))

    def test_the_token_goes_with_the_question(self):
        urlopen = self.answering({"private": False})
        check.ask_github("guhilling/conventions", "t0ken", urlopen)
        self.assertEqual(urlopen.call_args.args[0].get_header("Authorization"), "Bearer t0ken")

    def test_a_repository_github_will_not_show(self):
        error = urllib.error.HTTPError("https://api.github.com/repos/guhilling/monitoring", 404,
                                       "Not Found", {}, io.BytesIO(b"{}"))
        urlopen = mock.MagicMock(side_effect=error)
        self.assertEqual(check.ask_github("guhilling/monitoring", None, urlopen), (404, None))


if __name__ == "__main__":
    unittest.main()
