"""
Pins down what check-private-links.py asks of a link to a private resource (#531): one to a
repository that isn't public, or to a console on the script's list, is followed by ` (private)`,
and one to a public repository is not.

GitHub is never asked: the question is a function the tests pass in, and the one that does ask
GitHub gets a stand-in for urlopen. The pages are rendered as the documentation site renders them,
so these need the packages in requirements.txt.

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

PAGE = "guide/page.md"
MONITORING = "https://github.com/guhilling/monitoring"


class Asker:
    """GitHub's answers by repository (public or not), recording what it was asked about."""

    def __init__(self, *public, unanswered=None):
        """`public` are the public repositories; `unanswered` gives a reason by repository."""
        self.public = set(public)
        self.unanswered = unanswered or {}
        self.asked = []

    def __call__(self, repository):
        """Whether `repository` is public, as check-private-links.py's `ask` says it."""
        self.asked.append(repository)
        if repository in self.unanswered:
            raise check.Unanswered(self.unanswered[repository])
        return repository in self.public


def problems(text, ask=None):
    """The problems check-private-links.py finds in one page."""
    return check.check({PAGE: text}, ask or Asker()).problems


def needs(line, name):
    """The problem of a link to `name` on `line` that lacks the marker."""
    return (PAGE, line, f"the link to {name} needs ' (private)' after it:"
                        f" the repository is not public")


class MarkerTest(unittest.TestCase):
    """Which links need the marker, and where it may stand."""

    def test_a_link_to_a_private_repository_without_the_marker(self):
        """A link to a private repository without the marker."""
        text = f"Intro.\n\nSee [guhilling/monitoring]({MONITORING}).\n"
        self.assertEqual(problems(text), [needs(3, "guhilling/monitoring")])

    def test_a_link_to_a_private_repository_with_the_marker(self):
        """A link to a private repository with the marker."""
        self.assertEqual(problems(f"See [guhilling/monitoring]({MONITORING}) (private).\n"), [])

    def test_the_marker_may_follow_a_hard_line_break(self):
        """The marker may follow a hard line break."""
        self.assertEqual(problems(f"See [m]({MONITORING})  \n(private), whose\n"), [])
        self.assertEqual(problems(f"See {MONITORING}  \n(private), whose\n"), [])

    def test_a_marker_after_a_line_break_and_other_markup_is_not_the_links(self):
        """A marker after a line break and other markup is not the link's."""
        self.assertEqual(problems(f"See [m]({MONITORING})  \n*(private)*\n"),
                         [needs(1, "guhilling/monitoring")])

    def test_the_marker_may_start_the_next_line(self):
        """The marker may start the next line."""
        self.assertEqual(problems(f"See [guhilling/monitoring]({MONITORING})\n(private), whose\n"),
                         [])

    def test_the_marker_is_plain_text_and_follows_at_once(self):
        """The marker is plain text and follows at once."""
        self.assertEqual(len(problems(f"[a]({MONITORING}), (private)\n")), 1)

    def test_the_marker_may_follow_emphasis_around_the_link(self):
        """The marker may follow emphasis around the link."""
        self.assertEqual(problems(f"**[a]({MONITORING})** (private)\n"), [])

    def test_the_marker_in_the_next_table_cell_is_not_the_links(self):
        """The marker in the next table cell is not the link's."""
        text = f"| a | b |\n| --- | --- |\n| [m]({MONITORING}) | (private) |\n"
        self.assertEqual(problems(text), [needs(3, "guhilling/monitoring")])

    def test_a_link_to_a_public_repository(self):
        """A link to a public repository."""
        ask = Asker("guhilling/conventions")
        self.assertEqual(problems("[c](https://github.com/guhilling/conventions)\n", ask), [])

    def test_a_marker_on_a_link_to_a_public_repository_is_stale(self):
        """A marker on a link to a public repository is stale."""
        ask = Asker("guhilling/conventions")
        text = "[c](https://github.com/guhilling/conventions) (private)\n"
        self.assertEqual(problems(text, ask), [
            (PAGE, 1, "the link to guhilling/conventions has ' (private)' after it,"
                      " but the repository is public")])

    def test_this_repository_is_public_without_asking(self):
        """This repository is public without asking."""
        ask = Asker()
        text = "[#508](https://github.com/guhilling/ai-assisted-todolist/issues/508)\n"
        self.assertEqual(problems(text, ask), [])
        self.assertEqual(ask.asked, [])

    def test_www_github_com_is_github_com(self):
        """www.github.com is github.com."""
        text = "[a](https://www.github.com/guhilling/monitoring/issues)\n"
        self.assertEqual(problems(text), [needs(1, "guhilling/monitoring")])
        ask = Asker("guhilling/conventions")
        self.assertEqual(problems("[c](https://www.github.com/guhilling/conventions)\n", ask), [])

    def test_a_deep_link_is_a_link_to_its_repository(self):
        """A deep link is a link to its repository."""
        text = f"[server]({MONITORING}/blob/main/doc/server.md)\n"
        self.assertEqual(problems(text), [needs(1, "guhilling/monitoring")])

    def test_each_repository_is_asked_about_once(self):
        """Each repository is asked about once."""
        ask = Asker()
        text = (f"[a]({MONITORING}) (private)\n"
                f"[b]({MONITORING}/blob/main/x.md) (private)\n"
                "[c](https://github.com/Guhilling/Monitoring.git) (private)\n")
        self.assertEqual(problems(text, ask), [])
        self.assertEqual(ask.asked, ["guhilling/monitoring"])

    def test_every_page_is_checked_and_the_repositories_asked_about_once_in_all(self):
        """Every page is checked and the repositories asked about once in all."""
        ask = Asker()
        pages = {"README.md": f"[a]({MONITORING})\n", PAGE: f"[b]({MONITORING})\n"}
        self.assertEqual([problem[0] for problem in check.check(pages, ask).problems],
                         ["README.md", PAGE])
        self.assertEqual(ask.asked, ["guhilling/monitoring"])

    def test_the_links_are_counted_in_the_same_pass(self):
        """The links are counted in the same pass."""
        ask = Asker("guhilling/conventions")
        pages = {"README.md": f"[a]({MONITORING}) (private)\n[elsewhere](https://example.com)\n",
                 PAGE: "[c](https://github.com/guhilling/conventions)\n"}
        self.assertEqual(check.check(pages, ask).links, 2)


class LineTest(unittest.TestCase):
    """The line a problem is reported on."""

    def test_the_line_counts_the_lines_of_a_code_block(self):
        """The line counts the lines of a code block."""
        text = f"```\none\ntwo\n```\n[a]({MONITORING})\n"
        self.assertEqual(problems(text), [needs(5, "guhilling/monitoring")])

    def test_each_of_two_links_to_one_repository_has_its_own_line(self):
        """Each of two links to one repository has its own line."""
        text = f"[a]({MONITORING})\n\n[b]({MONITORING})\n"
        self.assertEqual([problem[1] for problem in problems(text)], [1, 3])


class WhatCountsAsALinkTest(unittest.TestCase):
    """The kinds of link a reader sees as one, and the GitHub pages that are no repository."""

    def test_an_autolink(self):
        """An autolink."""
        self.assertEqual(problems(f"<{MONITORING}> (private)\n"), [])
        self.assertEqual(len(problems(f"<{MONITORING}>\n")), 1)

    def test_an_angle_bracketed_destination(self):
        """An angle-bracketed destination."""
        self.assertEqual(problems(f"[m](<{MONITORING}>) (private)\n"), [])
        self.assertEqual(len(problems(f"[m](<{MONITORING}>)\n")), 1)

    def test_an_html_link(self):
        """An HTML link."""
        self.assertEqual(problems(f'<a href="{MONITORING}">m</a> (private)\n'), [])
        self.assertEqual(len(problems(f'<a href="{MONITORING}">m</a>\n')), 1)

    def test_a_bare_url_ends_before_the_punctuation_after_it(self):
        """A bare URL ends before the punctuation after it."""
        self.assertEqual(problems(f"At {MONITORING} (private).\n"), [])
        self.assertEqual(problems(f"At {MONITORING}.\n"), [needs(1, "guhilling/monitoring")])

    def test_a_bare_url_at_the_end_of_a_line_with_the_marker_on_the_next(self):
        """A bare URL at the end of a line with the marker on the next."""
        self.assertEqual(problems(f"At {MONITORING}\n(private).\n"), [])

    def test_a_url_in_the_text_of_its_link_is_one_link(self):
        """A URL in the text of its link is one link."""
        text = f"[see {MONITORING} here]({MONITORING}) (private)\n"
        result = check.check({PAGE: text}, Asker())
        self.assertEqual((result.problems, result.links), ([], 1))

    def test_titles_in_every_quoting(self):
        """Titles in every quoting."""
        for title in ('"The stack"', "'The stack'", "(The stack)"):
            with self.subTest(title=title):
                self.assertEqual(problems(f"[a]({MONITORING} {title}) (private)\n"), [])
                self.assertEqual(len(problems(f"[a]({MONITORING} {title})\n")), 1)

    def test_a_badge_is_marked_after_the_link_around_it(self):
        """A badge is marked after the link around it."""
        badge = ("[![CI](https://github.com/guhilling/web/actions/workflows/ci.yml/badge.svg)]"
                 "(https://github.com/guhilling/web/actions/workflows/ci.yml)")
        self.assertEqual(problems(badge + " (private)\n"), [])
        self.assertEqual(problems(badge + "\n"), [needs(1, "guhilling/web")])

    def test_a_github_page_that_is_no_repository(self):
        """A GitHub page that is no repository."""
        ask = Asker()
        text = ("[project](https://github.com/users/someone/projects/2)\n"
                "[org](https://github.com/orgs/someone/projects/1)\n"
                "[mine](https://github.com/issues/assigned)\n"
                "[pulls](https://github.com/pulls)\n"
                "[settings](https://github.com/settings/keys)\n"
                "[user](https://github.com/guhilling)\n")
        self.assertEqual(problems(text, ask), [])
        self.assertEqual(ask.asked, [])

    def test_a_marker_after_a_link_elsewhere_is_not_checked(self):
        """A marker after a link elsewhere is not checked."""
        self.assertEqual(problems("[TaskFest](https://taskfest.cloud.hilling.de) (private)\n"), [])


class CodeTest(unittest.TestCase):
    """A URL in code is no link, however the code is written."""

    def assertNoLinks(self, text):
        """Asserts that `text` has no link, and that GitHub was not asked about any."""
        ask = Asker()
        result = check.check({PAGE: text}, ask)
        self.assertEqual((result.problems, result.links, ask.asked), ([], 0, []))

    def test_a_url_in_a_fenced_code_block(self):
        """A URL in a fenced code block."""
        self.assertNoLinks(f"```\ngit clone {MONITORING}\n```\n~~~\n{MONITORING}\n~~~\n")

    def test_a_url_in_inline_code(self):
        """A URL in inline code."""
        self.assertNoLinks(f"Clone `{MONITORING}` there.\n")

    def test_a_url_in_an_indented_code_block(self):
        """A URL in an indented code block."""
        self.assertNoLinks(f"Text.\n\n    git clone {MONITORING}\n")

    def test_a_url_in_a_fence_inside_a_list(self):
        """A URL in a fence inside a list."""
        self.assertNoLinks(f"1. Clone it:\n\n    ```\n    git clone {MONITORING}\n    ```\n")

    def test_inline_code_wrapped_over_two_lines(self):
        """Inline code wrapped over two lines."""
        text = f"Run `g clone\nfoo` then see [m]({MONITORING}) and `x`.\n"
        self.assertEqual(problems(text), [needs(2, "guhilling/monitoring")])

    def test_a_longer_fence_around_a_shorter_one(self):
        """A longer fence around a shorter one."""
        text = f"````\n```\n````\n{MONITORING}\n````\n"
        self.assertEqual(problems(text), [needs(4, "guhilling/monitoring")])


class PrivateResourceTest(unittest.TestCase):
    """The consoles and the project on the script's list, which nothing can ask about."""

    URLS = [
        "https://appstoreconnect.apple.com/apps",
        "https://play.google.com/console/u/0/developers",
        "https://console.aws.amazon.com/billing/home",
        "https://eu-central-1.console.aws.amazon.com/ecs/v2/clusters",
        "https://console.hetzner.cloud/projects",
        "https://console.hetzner.com/",
        "https://accounts.hetzner.com/login",
        "https://github.com/users/guhilling/projects/2",
        "https://github.com/users/guhilling/projects/2/views/1",
        "https://www.github.com/users/guhilling/projects/2",
    ]

    def test_a_console_link_with_the_marker(self):
        """A console link with the marker."""
        for url in self.URLS:
            with self.subTest(url=url):
                ask = Asker()
                self.assertEqual(problems(f"[there]({url}) (private)\n", ask), [])
                self.assertEqual(ask.asked, [])

    def test_a_console_link_without_the_marker(self):
        """A console link without the marker."""
        for url in self.URLS:
            with self.subTest(url=url):
                self.assertEqual(problems(f"[there]({url})\n"), [
                    (PAGE, 1, f"the link to {url} needs ' (private)' after it:"
                              f" it leads to a private resource")])

    def test_only_the_resource_itself(self):
        """Only the resource itself."""
        text = ("[other project](https://github.com/users/guhilling/projects/20)\n"
                "[store](https://play.google.com/store/apps)\n"
                "[docs](https://docs.aws.amazon.com/console/)\n")
        self.assertEqual(problems(text), [])


class UnansweredTest(unittest.TestCase):
    """A repository GitHub could not be asked about."""

    def test_a_repository_github_could_not_be_asked_about(self):
        """A repository GitHub could not be asked about."""
        ask = Asker(unanswered={"guhilling/monitoring": "HTTP Error 403: rate limit exceeded"})
        text = f"[a]({MONITORING})\n[b]({MONITORING}) (private)\n"
        self.assertEqual(problems(text, ask), [
            (PAGE, 1, "could not ask GitHub about guhilling/monitoring:"
                      " HTTP Error 403: rate limit exceeded")])


class AskGitHubTest(unittest.TestCase):
    """What GitHub's answers mean, with urlopen replaced."""

    @staticmethod
    def answering(body, status=200):
        """A response from GitHub with `body` as JSON."""
        response = mock.MagicMock()
        response.__enter__.return_value.status = status
        response.__enter__.return_value.read.return_value = json.dumps(body).encode()
        return response

    @staticmethod
    def http_error(code):
        """GitHub answering with the HTTP error `code`."""
        return urllib.error.HTTPError("https://api.github.com/repos/o/r", code, "No",
                                      {}, io.BytesIO(b"{}"))

    def ask(self, *answers, token=None):
        """ask_github's answer when GitHub gives `answers` in turn, and the urlopen asked."""
        urlopen = mock.MagicMock(side_effect=list(answers))
        return check.ask_github("guhilling/r", token, urlopen, pause=0), urlopen

    def unanswered(self, *answers):
        """The reason ask_github gives when `answers` leave the question unanswered."""
        with self.assertRaises(check.Unanswered) as raised:
            self.ask(*answers)
        return str(raised.exception)

    def test_a_public_repository(self):
        """A public repository."""
        public, urlopen = self.ask(self.answering({"private": False}))
        self.assertTrue(public)
        request = urlopen.call_args.args[0]
        self.assertEqual(request.full_url, "https://api.github.com/repos/guhilling/r")
        self.assertIsNone(request.get_header("Authorization"))

    def test_a_private_repository(self):
        """A private repository."""
        self.assertFalse(self.ask(self.answering({"private": True}))[0])

    def test_the_token_goes_with_the_question(self):
        """The token goes with the question."""
        _, urlopen = self.ask(self.answering({"private": False}), token="t0ken")
        self.assertEqual(urlopen.call_args.args[0].get_header("Authorization"), "Bearer t0ken")

    def test_a_repository_github_will_not_show_is_not_public_at_once(self):
        """A repository GitHub will not show is not public at once."""
        public, urlopen = self.ask(self.http_error(404))
        self.assertFalse(public)
        self.assertEqual(urlopen.call_count, 1)

    def test_a_failure_is_tried_again(self):
        """A failure is tried again."""
        public, urlopen = self.ask(self.http_error(502), self.answering({"private": False}))
        self.assertTrue(public)
        self.assertEqual(urlopen.call_count, 2)

    def test_a_rate_limit_every_time(self):
        """A rate limit every time."""
        self.assertIn("HTTP Error 403", self.unanswered(*[self.http_error(403)] * 3))
        self.assertIn("HTTP Error 429", self.unanswered(*[self.http_error(429)] * 3))

    def test_a_server_error_every_time(self):
        """A server error every time."""
        self.assertIn("HTTP Error 503", self.unanswered(*[self.http_error(503)] * 3))

    def test_no_connection(self):
        """No connection."""
        error = urllib.error.URLError("no route to host")
        self.assertIn("no route to host", self.unanswered(error, error, error))

    def test_a_timeout(self):
        """A timeout."""
        self.assertIn("timed out", self.unanswered(*[TimeoutError("timed out")] * 3))

    def test_an_answer_that_is_no_json(self):
        """An answer that is no JSON."""
        response = self.answering({})
        response.__enter__.return_value.read.return_value = b"<html>"
        self.assertIn("JSON", self.unanswered(response))

    def test_an_answer_that_says_nothing_of_privacy(self):
        """An answer that says nothing of privacy."""
        self.assertIn("private", self.unanswered(self.answering({"name": "r"})))


class MainTest(unittest.TestCase):
    """What the script prints and returns."""

    def test_an_unanswered_question_is_an_error_not_a_traceback(self):
        """An unanswered question is an error, not a traceback."""
        pages = {PAGE: f"[a]({MONITORING})\n"}
        output = io.StringIO()
        with mock.patch.object(check, "pages", return_value=pages), \
                mock.patch.object(check, "ask_github",
                                  side_effect=check.Unanswered("no route")), \
                mock.patch("sys.stdout", output):
            self.assertEqual(check.main(), 1)
        self.assertIn(f"::error file={PAGE},line=1::", output.getvalue())
        self.assertIn("no route", output.getvalue())


if __name__ == "__main__":
    unittest.main()
