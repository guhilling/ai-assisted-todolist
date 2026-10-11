"""
Pins down check-workflow-caches.py: Maven's and npm's caches are read everywhere and saved from
main only (#308), so that pull requests -- Renovate's above all -- no longer fill the Actions cache
with a copy each.

Run with:  python3 -m unittest discover -s .github/scripts -p 'test_*.py'
"""

import importlib.util
import pathlib
import textwrap
import unittest

_spec = importlib.util.spec_from_file_location(
    "check_workflow_caches", pathlib.Path(__file__).with_name("check-workflow-caches.py"))
check = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(check)


def workflow(steps):
    return "jobs:\n  build:\n    steps:\n" + textwrap.indent(textwrap.dedent(steps), "      ")


class CheckTest(unittest.TestCase):

    def test_setup_java_without_its_cache_passes(self):
        self.assertEqual(check.problems(workflow("""
            - uses: actions/setup-java@v6
              with:
                distribution: temurin
                java-version: '25'
            """)), [])

    def test_setup_java_s_own_cache_is_named(self):
        found = check.problems(workflow("""
            - uses: actions/setup-java@v6
              with:
                java-version: '25'
                cache: maven
            """))
        self.assertEqual(len(found), 1, found)
        self.assertIn("actions/setup-java", found[0])

    def test_setup_node_s_own_cache_is_named(self):
        found = check.problems(workflow("""
            - uses: actions/setup-node@v7
              with:
                node-version-file: frontend/.nvmrc
                cache: npm
                cache-dependency-path: frontend/package-lock.json
            """))
        self.assertEqual(len(found), 1, found)
        self.assertIn("actions/setup-node", found[0])

    def test_a_cache_input_of_the_next_step_is_not_the_setup_step_s(self):
        self.assertEqual(check.problems(workflow("""
            - uses: actions/setup-node@v7
              with:
                node-version: '24'
            - uses: actions/cache/restore@v6
              with:
                path: ~/.npm
                key: npm-x
            """)), [])

    def test_a_save_from_main_only_passes(self):
        self.assertEqual(check.problems(workflow("""
            - uses: actions/cache/save@v6
              if: github.ref == 'refs/heads/main' && steps.maven.outputs.cache-hit != 'true'
              with:
                path: ~/.m2/repository
                key: ${{ steps.maven.outputs.cache-primary-key }}
            """)), [])

    def test_a_condition_folded_over_lines_is_read_whole(self):
        self.assertEqual(check.problems(workflow("""
            - uses: actions/cache/save@v6
              if: >-
                matrix.language == 'java-kotlin' && github.ref == 'refs/heads/main'
                && steps.maven-cache.outputs.cache-hit != 'true'
              with:
                path: ~/.m2/repository
                key: maven-x
            """)), [])

    def test_a_save_from_any_branch_is_named(self):
        found = check.problems(workflow("""
            - name: Save Maven's cache
              uses: actions/cache/save@v6
              with:
                path: ~/.m2/repository
                key: maven-x
            """))
        self.assertEqual(len(found), 1, found)
        self.assertIn("actions/cache/save", found[0])

    def test_every_workflow_here_keeps_the_rule(self):
        workflows = pathlib.Path(__file__).parents[1] / "workflows"
        found = {path.name: check.problems(path.read_text()) for path in sorted(workflows.glob("*.yml"))}
        self.assertEqual({name: problems for name, problems in found.items() if problems}, {})


if __name__ == "__main__":
    unittest.main()
