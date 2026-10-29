"""
Pins down what check-decisions.py asks of the decisions under doc/decisions/: a status line under
every decision, and an index that lists every decision, and only those, in the chapters' order.

Run with:  python3 -m unittest discover -s .github/scripts -p 'test_*.py'
"""

import importlib.util
import pathlib
import unittest

_spec = importlib.util.spec_from_file_location(
    "check_decisions", pathlib.Path(__file__).with_name("check-decisions.py"))
check = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(check)


def chapter(*sections):
    """A chapter of decisions, each section given as (heading, the line under it)."""
    return "\n".join(f"## {heading}\n\n{line}\n\nWhy, at length.\n" for heading, line in sections)


class StatusLineTest(unittest.TestCase):

    def test_an_accepted_decision_with_its_date_and_pull_request(self):
        text = chapter(("Jib with a pinned base image", "*Accepted · 2026-09-25 · #14*"))
        self.assertEqual(check.status_problems(text), [])

    def test_several_issues_and_pull_requests(self):
        text = chapter(("Several providers", "*Accepted · 2026-10-07 · #143, #194*"))
        self.assertEqual(check.status_problems(text), [])

    def test_a_superseded_decision_names_the_one_that_replaced_it(self):
        line = "*Superseded · 2026-09-25 · #14 · by [A main provider](authentication.md#a-main-provider)*"
        self.assertEqual(check.status_problems(chapter(("One tenant", line))), [])

    def test_a_decision_without_a_status_line(self):
        self.assertEqual(check.status_problems(chapter(("Panache entities", "**What.** Entities."))),
                         ["Panache entities: no status line under the heading"])

    def test_a_superseded_decision_that_does_not_say_by_what(self):
        text = chapter(("One tenant", "*Superseded · 2026-09-25 · #14*"))
        self.assertEqual(check.status_problems(text),
                         ["One tenant: a superseded decision says by which one"])

    def test_an_accepted_decision_cannot_be_replaced(self):
        line = "*Accepted · 2026-09-25 · #14 · by [Another](authentication.md#another)*"
        self.assertEqual(check.status_problems(chapter(("One tenant", line))),
                         ["One tenant: an accepted decision names no replacement; say Superseded"])

    def test_superseded_by_an_issue_where_no_decision_records_the_change(self):
        text = chapter(("A quiet marker", "*Superseded · 2026-09-27 · #51 · by #334*"))
        self.assertEqual(check.status_problems(text), [])

    def test_a_heading_inside_a_code_block_is_no_decision(self):
        text = chapter(("Compose probes", "*Accepted · 2026-09-27 · #51*")) + "```\n## not a decision\n```\n"
        self.assertEqual(check.status_problems(text), [])

    def test_a_heading_inside_a_tilde_code_block_is_no_decision(self):
        text = chapter(("Compose probes", "*Accepted · 2026-09-27 · #51*")) + "~~~\n## not a decision\n~~~\n"
        self.assertEqual(check.status_problems(text), [])

    def test_a_superseded_decision_keeps_a_summary(self):
        text = "## One tenant\n\n*Superseded · 2026-09-25 · #14 · by #194*\n\n## Next\n\n*Accepted · 2026-10-07 · #194*\n\nWhy.\n"
        self.assertEqual(check.status_problems(text),
                         ["One tenant: a superseded decision keeps a short summary of what it said"])

    def test_two_decisions_of_one_name(self):
        text = chapter(("Twice", "*Accepted · 2026-09-27 · #51*"), ("Twice", "*Accepted · 2026-09-28 · #52*"))
        self.assertEqual(check.status_problems(text), ["Twice: two decisions have this heading"])


class ReplacementTest(unittest.TestCase):

    CHAPTERS = {
        "authentication.md": chapter(
            ("One tenant", "*Superseded · 2026-09-25 · #14 · by [Main provider](#main-provider)*"),
            ("Main provider", "*Accepted · 2026-10-07 · #194*")),
        "testing.md": chapter(
            ("Old", "*Superseded · 2026-09-25 · #14 · by [Main provider](authentication.md#main-provider)*")),
    }

    def test_replacements_in_the_same_chapter_and_in_another(self):
        self.assertEqual(check.replacement_problems(self.CHAPTERS), [])

    def test_a_replacement_that_does_not_exist(self):
        chapters = dict(self.CHAPTERS, **{"testing.md": chapter(
            ("Old", "*Superseded · 2026-09-25 · #14 · by [Main](authentcation.md#main)*"))})
        self.assertEqual(check.replacement_problems(chapters),
                         ["testing.md: Old is superseded by authentcation.md#main, which is no decision"])

    def test_only_accepted_and_superseded_are_statuses(self):
        text = chapter(("Push through SNS", "*Proposed · 2026-10-10 · #269*"))
        self.assertEqual(check.status_problems(text),
                         ["Push through SNS: no status line under the heading"])

    def test_a_date_that_is_no_date(self):
        text = chapter(("Push through SNS", "*Accepted · 2026-13-10 · #269*"))
        self.assertEqual(check.status_problems(text),
                         ["Push through SNS: 2026-13-10 is not a date"])

    def test_the_pull_request_may_be_missing(self):
        text = chapter(("Before pull requests", "*Accepted · 2026-09-24*"))
        self.assertEqual(check.status_problems(text), [])


class IndexTest(unittest.TestCase):

    CHAPTERS = {
        "testing.md": chapter(("Dev Services, not Testcontainers", "*Accepted · 2026-09-25 · #14*"),
                              ("Coverage by `quarkus-jacoco`", "*Accepted · 2026-09-26 · #18*")),
    }

    def test_every_decision_listed_in_order_with_its_anchor(self):
        index = ("## [Testing](testing.md)\n\n"
                 "- [Dev Services, not Testcontainers](testing.md#dev-services-not-testcontainers)\n"
                 "- [Coverage by `quarkus-jacoco`](testing.md#coverage-by-quarkus-jacoco)\n")
        self.assertEqual(check.index_problems(index, self.CHAPTERS), [])

    def test_a_decision_missing_from_the_index(self):
        index = "## [Testing](testing.md)\n\n- [Dev Services, not Testcontainers](testing.md#dev-services-not-testcontainers)\n"
        self.assertEqual(check.index_problems(index, self.CHAPTERS),
                         ["index.md does not list testing.md's decisions as they are: expected\n"
                          "  Dev Services, not Testcontainers\n"
                          "  Coverage by `quarkus-jacoco`"])

    def test_an_entry_for_a_decision_that_is_gone_or_renamed(self):
        index = ("## [Testing](testing.md)\n\n- [Dev Services, not Testcontainers](testing.md#dev-services-not-testcontainers)\n"
                 "- [Coverage by `quarkus-jacoco`](testing.md#coverage-by-quarkus-jacoco)\n"
                 "- [Hand-rolled Testcontainers](testing.md#hand-rolled-testcontainers)\n")
        self.assertEqual(len(check.index_problems(index, self.CHAPTERS)), 1)

    def test_an_entry_for_a_chapter_that_does_not_exist(self):
        index = ("## [Testing](testing.md)\n\n"
                 "- [Dev Services, not Testcontainers](testing.md#dev-services-not-testcontainers)\n"
                 "- [Coverage by `quarkus-jacoco`](testing.md#coverage-by-quarkus-jacoco)\n"
                 "- [Old](removed.md#old)\n")
        self.assertEqual(check.index_problems(index, self.CHAPTERS),
                         ["index.md lists Old under testing.md, linking to removed.md#old"])

    def test_a_list_item_that_is_not_an_entry(self):
        index = ("## [Testing](testing.md)\n\n"
                 "- [Dev Services, not Testcontainers](testing.md#dev-services-not-testcontainers)\n"
                 "- [Coverage by `quarkus-jacoco`](testing.md#coverage-by-quarkus-jacoco)\n"
                 "- [Odd](./testing.md#odd)\n")
        self.assertEqual(check.index_problems(index, self.CHAPTERS),
                         ["index.md has a list item that is no entry: - [Odd](./testing.md#odd)"])

    def test_a_chapter_the_index_has_no_section_for(self):
        self.assertEqual(check.index_problems("# Decisions\n", self.CHAPTERS),
                         ["index.md has no section for testing.md"])

    def test_an_anchor_that_does_not_match_its_heading(self):
        index = ("## [Testing](testing.md)\n\n- [Dev Services, not Testcontainers](testing.md#dev-services)\n"
                 "- [Coverage by `quarkus-jacoco`](testing.md#coverage-by-quarkus-jacoco)\n")
        self.assertEqual(check.index_problems(index, self.CHAPTERS),
                         ["index.md links Dev Services, not Testcontainers as testing.md#dev-services,"
                          " but its anchor is #dev-services-not-testcontainers"])


if __name__ == "__main__":
    unittest.main()
