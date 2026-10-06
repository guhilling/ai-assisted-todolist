"""
Pins down what image-findings-issue.py does with Inspector's findings, without AWS or GitHub.

The script is the only route from a vulnerable running image to a person (#162). Getting the
decision wrong is either silence, a duplicate issue, or a comment every day about the same
finding -- which teaches everyone to ignore it.

Run with:  python3 -m unittest discover -s .github/scripts -p 'test_*.py'
"""

import importlib.util
import pathlib
import unittest

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
    """Closing the issue by hand means the findings were looked at, so they are not raised again."""

    def body_listing(self, *found):
        return findings.decide(list(found), None, **CONTEXT).body

    def test_findings_in_an_issue_closed_by_hand_open_nothing(self):
        action = findings.decide([A], open_issue=None, acknowledged=findings.reported(self.body_listing(A)),
                                 **CONTEXT)
        self.assertEqual(action.kind, "none")

    def test_a_new_finding_after_that_opens_an_issue_listing_only_it(self):
        action = findings.decide([A, B], open_issue=None,
                                 acknowledged=findings.reported(self.body_listing(A)), **CONTEXT)
        self.assertEqual(action.kind, "create")
        self.assertIn("CVE-2026-0002", action.body)
        self.assertNotIn("CVE-2026-0001", action.body)

    def test_closing_it_ourselves_acknowledges_nothing(self):
        open_issue = {"number": 7, "body": self.body_listing(A)}
        action = findings.decide([], open_issue=open_issue, **CONTEXT)
        self.assertEqual(action.kind, "close")
        self.assertEqual(findings.reported(action.body), set())


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

    def test_a_finding_both_queries_return_is_reported_once(self):
        first = dict(finding("CVE-2026-0001"), findingArn="arn:finding/1")
        second = dict(finding("CVE-2026-0002"), findingArn="arn:finding/2")
        merged = findings.merge([first, second], [dict(first)])
        self.assertEqual([f["findingArn"] for f in merged], ["arn:finding/1", "arn:finding/2"])


if __name__ == "__main__":
    unittest.main()
