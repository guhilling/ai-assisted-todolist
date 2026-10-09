"""
Pins down what image-findings-issue.py does with Inspector's findings, without AWS or GitHub.

The script is the only route from a vulnerable running image to a person (#162). Getting the
decision wrong is either silence, a duplicate issue, or a comment every day about the same
finding -- which teaches everyone to ignore it.

Run with:  python3 -m unittest discover -s .github/scripts -p 'test_*.py'
"""

import importlib.util
import json
import pathlib
import unittest
from unittest import mock

_spec = importlib.util.spec_from_file_location(
    "image_findings_issue", pathlib.Path(__file__).with_name("image-findings-issue.py"))
findings = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(findings)


def finding(cve, package="jackson-databind", version="2.22.2", fixed="2.22.3",
            severity="HIGH", repository="quay/ghilling/taskfest-backend", tags=("latest",)):
    """One Inspector finding, shaped as list-findings returns it."""
    return {
        "severity": severity,
        "title": f"{cve} - {package}",
        "packageVulnerabilityDetails": {
            "vulnerabilityId": cve,
            "sourceUrl": f"https://nvd.nist.gov/vuln/detail/{cve}",
            "vulnerablePackages": [
                {"name": package, "version": version, "fixedInVersion": fixed},
            ],
        },
        "resources": [{
            "details": {"awsEcrContainerImage": {"repositoryName": repository, "imageTags": list(tags)}},
        }],
    }


CONTEXT = {"run_url": "https://github.com/o/r/actions/runs/1"}
A = finding("CVE-2026-0001")
B = finding("CVE-2026-0002", package="openssl-libs", version="3.5.8", fixed="3.5.9", severity="CRITICAL")


class DecideTest(unittest.TestCase):

    def test_no_findings_and_no_issue_does_nothing(self):
        self.assertEqual(findings.decide([], open_issue=None, **CONTEXT).kind, "none")

    def test_findings_and_no_issue_open_one(self):
        action = findings.decide([A], open_issue=None, **CONTEXT)
        self.assertEqual(action.kind, "create")
        self.assertIn("CVE-2026-0001", action.body)
        self.assertIn("2.22.3", action.body)
        self.assertIn("quay/ghilling/taskfest-backend:latest", action.body)

    def test_the_same_findings_again_update_quietly(self):
        open_issue = {"number": 7, "body": findings.decide([A], None, **CONTEXT).body}
        action = findings.decide([A], open_issue=open_issue, **CONTEXT)
        self.assertEqual(action.kind, "update")
        self.assertEqual(action.comment, "")

    def test_a_new_finding_updates_and_comments_on_just_the_new_one(self):
        open_issue = {"number": 7, "body": findings.decide([A], None, **CONTEXT).body}
        action = findings.decide([A, B], open_issue=open_issue, **CONTEXT)
        self.assertEqual(action.kind, "update")
        self.assertEqual(action.issue, 7)
        self.assertIn("CVE-2026-0002", action.comment)
        self.assertNotIn("CVE-2026-0001", action.comment)
        self.assertIn("CVE-2026-0001", action.body)

    def test_no_findings_close_the_open_issue(self):
        open_issue = {"number": 7, "body": findings.decide([A], None, **CONTEXT).body}
        action = findings.decide([], open_issue=open_issue, **CONTEXT)
        self.assertEqual(action.kind, "close")
        self.assertEqual(action.issue, 7)

    def test_critical_is_listed_before_high(self):
        body = findings.decide([A, B], None, **CONTEXT).body
        self.assertLess(body.index("CVE-2026-0002"), body.index("CVE-2026-0001"))

    def test_one_vulnerability_in_two_images_is_one_row_naming_both(self):
        other = finding("CVE-2026-0001", tags=("0.3.0",))
        body = findings.decide([A, other], None, **CONTEXT).body
        self.assertEqual(body.count("| [CVE-2026-0001]"), 1)
        self.assertIn("taskfest-backend:0.3.0", body)
        self.assertIn("taskfest-backend:latest", body)


class AcknowledgedTest(unittest.TestCase):
    """Findings in an issue closed as *not planned* were accepted, and are not raised again."""

    def keys(self, *found):
        return findings.reported(findings.decide(list(found), None, **CONTEXT).body)

    def test_accepted_findings_open_nothing(self):
        action = findings.decide([A], open_issue=None, acknowledged=self.keys(A), **CONTEXT)
        self.assertEqual(action.kind, "none")

    def test_a_new_finding_opens_an_issue_listing_only_it(self):
        action = findings.decide([A, B], open_issue=None, acknowledged=self.keys(A), **CONTEXT)
        self.assertEqual(action.kind, "create")
        self.assertIn("CVE-2026-0002", action.body)
        self.assertNotIn("CVE-2026-0001", action.body)

    def test_accepted_findings_stay_out_of_an_open_issue_on_later_runs(self):
        open_issue = {"number": 8, "body": findings.decide([B], None, **CONTEXT).body}
        action = findings.decide([A, B], open_issue=open_issue, acknowledged=self.keys(A), **CONTEXT)
        self.assertEqual(action.kind, "update")
        self.assertNotIn("CVE-2026-0001", action.body)
        self.assertEqual(action.comment, "")

    def test_an_open_issue_left_with_only_accepted_findings_is_closed(self):
        open_issue = {"number": 8, "body": findings.decide([A], None, **CONTEXT).body}
        action = findings.decide([A], open_issue=open_issue, acknowledged=self.keys(A), **CONTEXT)
        self.assertEqual(action.kind, "close")

    def test_only_issues_closed_as_not_planned_acknowledge_anything(self):
        accepted = {"stateReason": "NOT_PLANNED", "body": findings.decide([A], None, **CONTEXT).body}
        fixed = {"stateReason": "COMPLETED", "body": findings.decide([B], None, **CONTEXT).body}
        self.assertEqual(findings.acknowledged_by([accepted, fixed]), self.keys(A))

    def test_acknowledgements_add_up_across_issues(self):
        first = {"stateReason": "NOT_PLANNED", "body": findings.decide([A], None, **CONTEXT).body}
        second = {"stateReason": "NOT_PLANNED", "body": findings.decide([B], None, **CONTEXT).body}
        self.assertEqual(findings.acknowledged_by([first, second]), self.keys(A) | self.keys(B))


class AcceptedLeftoverTest(unittest.TestCase):

    def test_an_open_issue_left_with_only_accepted_findings_closes_as_not_planned(self):
        open_issue = {"number": 8, "body": findings.decide([A], None, **CONTEXT).body}
        accepted = findings.reported(open_issue["body"])
        action = findings.decide([A], open_issue=open_issue, acknowledged=accepted, **CONTEXT)
        self.assertEqual(action.kind, "close")
        self.assertEqual(action.reason, "not planned")

    def test_an_issue_whose_findings_are_gone_closes_as_completed(self):
        open_issue = {"number": 8, "body": findings.decide([A], None, **CONTEXT).body}
        action = findings.decide([], open_issue=open_issue, **CONTEXT)
        self.assertEqual(action.reason, "completed")


class MainTest(unittest.TestCase):
    """What main() does with gh, with gh and Inspector stubbed out."""

    def run_main(self, found, open_issue, still_open=True, accepted=frozenset()):
        calls = []

        def gh(*args):
            calls.append(args)
            if args[:2] == ("issue", "view"):
                return '{"state": "%s"}' % ("OPEN" if still_open else "CLOSED")
            return ""

        env = {"GITHUB_SERVER_URL": "https://github.com", "GITHUB_REPOSITORY": "o/r", "GITHUB_RUN_ID": "1"}
        with mock.patch.dict("os.environ", env), \
                mock.patch.object(findings, "gh", gh), \
                mock.patch.object(findings, "list_findings", return_value=found), \
                mock.patch.object(findings, "find_open_issue", return_value=open_issue), \
                mock.patch.object(findings, "accepted_keys", return_value=set(accepted)):
            findings.main()
        return calls

    def test_a_new_issue_gets_its_priority(self):
        calls = self.run_main([A], None)
        create = next(c for c in calls if c[:2] == ("issue", "create"))
        self.assertIn("priority: 1 now", create)

    def test_closing_names_the_reason(self):
        open_issue = {"number": 7, "body": findings.decide([A], None, **CONTEXT).body}
        calls = self.run_main([], open_issue)
        close = next(c for c in calls if c[:2] == ("issue", "close"))
        self.assertEqual(close[close.index("--reason") + 1], "completed")

    def test_an_issue_closed_during_the_run_is_left_alone(self):
        open_issue = {"number": 7, "body": findings.decide([A], None, **CONTEXT).body}
        calls = self.run_main([A, B], open_issue, still_open=False)
        self.assertFalse(any(c[:2] == ("issue", "edit") for c in calls))
        self.assertFalse(any(c[:2] == ("issue", "comment") for c in calls))

    def test_accepted_findings_are_not_fetched_when_there_are_no_findings(self):
        with mock.patch.object(findings, "gh", return_value="[]") as gh, \
                mock.patch.dict("os.environ", {"GITHUB_SERVER_URL": "s", "GITHUB_REPOSITORY": "r",
                                               "GITHUB_RUN_ID": "1"}), \
                mock.patch.object(findings, "list_findings", return_value=[]), \
                mock.patch.object(findings, "find_open_issue", return_value=None):
            findings.main()
        self.assertFalse(any("--search" in call.args for call in gh.call_args_list))


class FilterTest(unittest.TestCase):

    def test_asks_only_for_fixable_high_and_critical_in_recently_used_cached_images(self):
        criteria = findings.filter_criteria(now=1_000_000_000, days=30)
        self.assertEqual({f["value"] for f in criteria["severity"]}, {"HIGH", "CRITICAL"})
        self.assertEqual(criteria["fixAvailable"], [{"comparison": "EQUALS", "value": "YES"}])
        self.assertEqual(criteria["findingStatus"], [{"comparison": "EQUALS", "value": "ACTIVE"}])
        self.assertEqual(criteria["ecrImageRepositoryName"], [{"comparison": "PREFIX", "value": "quay/"}])
        self.assertEqual(criteria["ecrImageLastInUseAt"],
                         [{"startInclusive": 1_000_000_000 - 30 * 86400, "endInclusive": 1_000_000_000}])


class QueriesTest(unittest.TestCase):

    def test_asks_both_for_images_ecs_used_and_for_images_that_arrived_recently(self):
        in_use, arrived = findings.queries(now=1_000_000_000, days=30)
        window = [{"startInclusive": 1_000_000_000 - 30 * 86400, "endInclusive": 1_000_000_000}]
        self.assertEqual(in_use["ecrImageLastInUseAt"], window)
        self.assertNotIn("ecrImagePushedAt", in_use)
        self.assertEqual(arrived["ecrImagePushedAt"], window)
        self.assertNotIn("ecrImageLastInUseAt", arrived)
        for criteria in (in_use, arrived):
            self.assertEqual(criteria["fixAvailable"], [{"comparison": "EQUALS", "value": "YES"}])

    def test_an_untagged_image_counts_only_when_ecs_was_seen_using_it(self):
        superseded = dict(finding("CVE-2026-0003", tags=()), findingArn="arn:finding/3")
        current = dict(finding("CVE-2026-0004", tags=("latest",)), findingArn="arn:finding/4")
        merged = findings.merge_results(in_use=[], arrived=[superseded, current])
        self.assertEqual([f["findingArn"] for f in merged], ["arn:finding/4"])

    def test_an_untagged_image_ecs_runs_still_counts(self):
        running = dict(finding("CVE-2026-0003", tags=()), findingArn="arn:finding/3")
        merged = findings.merge_results(in_use=[running], arrived=[running])
        self.assertEqual([f["findingArn"] for f in merged], ["arn:finding/3"])

    def test_a_finding_both_queries_return_is_reported_once(self):
        first = dict(finding("CVE-2026-0001"), findingArn="arn:finding/1")
        second = dict(finding("CVE-2026-0002"), findingArn="arn:finding/2")
        merged = findings.merge([first, second], [dict(first)])
        self.assertEqual([f["findingArn"] for f in merged], ["arn:finding/1", "arn:finding/2"])



def child(cve, digest, tags=()):
    """A finding on one architecture's image of a multi-architecture release (#249)."""
    f = dict(finding(cve, tags=tags), findingArn=f"arn:finding/{cve}")
    f["resources"][0]["details"]["awsEcrContainerImage"]["imageHash"] = digest
    return f


class MultiArchitectureTest(unittest.TestCase):
    """ECS pulls a release's index by digest and then the image for its architecture; the cache keeps
    the index's tag and stores that image untagged, and Inspector scans the image, not the index."""

    INDEX = json.dumps({"manifests": [
        {"digest": "sha256:amd", "platform": {"architecture": "amd64", "os": "linux"}},
        {"digest": "sha256:arm", "platform": {"architecture": "arm64", "os": "linux"}},
    ]})

    def test_each_image_in_an_index_is_known_by_the_index_tags(self):
        tags = findings.index_tags_of([{"tags": ["0.15.0"], "manifest": self.INDEX}])
        self.assertEqual(tags, {"sha256:amd": ["0.15.0"], "sha256:arm": ["0.15.0"]})

    def test_an_image_from_a_tagged_index_counts_when_it_arrived_recently(self):
        fresh = child("CVE-2026-0005", "sha256:amd")
        merged = findings.merge_results(in_use=[], arrived=[fresh], index_tags={"sha256:amd": ["0.15.0"]})
        self.assertEqual([f["findingArn"] for f in merged], ["arn:finding/CVE-2026-0005"])

    def test_it_is_listed_under_the_release_it_belongs_to(self):
        fresh = child("CVE-2026-0005", "sha256:amd")
        merged = findings.merge_results(in_use=[], arrived=[fresh], index_tags={"sha256:amd": ["0.15.0"]})
        self.assertEqual(findings.rows(merged)[0].images, {"quay/ghilling/taskfest-backend:0.15.0"})

    def test_an_image_no_tagged_index_holds_any_longer_is_still_superseded(self):
        old = child("CVE-2026-0006", "sha256:old")
        self.assertEqual(findings.merge_results(in_use=[], arrived=[old], index_tags={"sha256:amd": ["0.15.0"]}), [])


if __name__ == "__main__":
    unittest.main()
