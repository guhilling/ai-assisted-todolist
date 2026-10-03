"""
Pins down what sonar-gate-issue.py does with a quality-gate result, without GitHub or SonarCloud.

The script is the only thing that tells anyone the gate failed: SonarCloud no longer runs on pull
requests, so a finding on main has no other route to a person. Getting the decision wrong is
either silence or a pile of duplicate issues, and both are easy to miss.

Run with:  python3 -m unittest discover -s .github/scripts -p 'test_*.py'
"""

import importlib.util
import pathlib
import unittest

_spec = importlib.util.spec_from_file_location(
    "sonar_gate_issue", pathlib.Path(__file__).with_name("sonar-gate-issue.py"))
gate = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(gate)

FAILED = {
    "projectStatus": {
        "status": "ERROR",
        "conditions": [
            {"metricKey": "new_coverage", "status": "ERROR", "actualValue": "71.2",
             "comparator": "LT", "errorThreshold": "80"},
            {"metricKey": "new_duplicated_lines_density", "status": "OK", "actualValue": "0.0",
             "comparator": "GT", "errorThreshold": "3"},
        ],
    }
}
PASSED = {"projectStatus": {"status": "OK", "conditions": []}}
CONTEXT = {"sha": "abc1234def", "run_url": "https://github.com/o/r/actions/runs/1"}


class DecideTest(unittest.TestCase):

    def test_a_failed_gate_with_no_open_issue_opens_one(self):
        action = gate.decide(FAILED, open_issue=None, **CONTEXT)
        self.assertEqual(action.kind, "create")

    def test_a_failed_gate_with_an_open_issue_only_comments_on_it(self):
        action = gate.decide(FAILED, open_issue=42, **CONTEXT)
        self.assertEqual((action.kind, action.issue), ("comment", 42))

    def test_a_passing_gate_closes_the_open_issue(self):
        action = gate.decide(PASSED, open_issue=42, **CONTEXT)
        self.assertEqual((action.kind, action.issue), ("close", 42))

    def test_a_passing_gate_with_nothing_open_does_nothing(self):
        action = gate.decide(PASSED, open_issue=None, **CONTEXT)
        self.assertEqual(action.kind, "none")

    def test_the_issue_names_only_the_failing_conditions(self):
        body = gate.decide(FAILED, open_issue=None, **CONTEXT).body
        self.assertIn("new_coverage", body)
        self.assertIn("71.2", body)
        self.assertNotIn("new_duplicated_lines_density", body)

    def test_the_issue_says_where_to_look(self):
        body = gate.decide(FAILED, open_issue=None, **CONTEXT).body
        self.assertIn("abc1234", body)
        self.assertIn(CONTEXT["run_url"], body)
        self.assertIn("sonarcloud.io", body)

    def test_an_unknown_gate_status_is_an_error_not_a_pass(self):
        # NONE means SonarCloud computed no gate at all; treating that as OK would close an
        # open issue on a run that proved nothing.
        with self.assertRaises(ValueError):
            gate.decide({"projectStatus": {"status": "NONE"}}, open_issue=42, **CONTEXT)


if __name__ == "__main__":
    unittest.main()
