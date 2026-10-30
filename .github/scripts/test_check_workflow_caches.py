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

    def test_a_save_of_something_else_from_any_branch_passes(self):
        # A build of the app, saved from pull requests too while the app is unchanged (#401).
        self.assertEqual(check.problems(workflow("""
            - uses: actions/cache/save@v6
              if: steps.app.outputs.cache-hit != 'true'
              with:
                path: mobile/build-ios/TaskFestDev.app
                key: taskfest-dev-ios-app-x
            """)), [])

    def test_a_condition_that_adds_other_refs_is_named(self):
        found = check.problems(workflow("""
            - uses: actions/cache/save@v6
              if: github.ref == 'refs/heads/main' || github.event_name == 'pull_request'
              with:
                path: ~/.npm
                key: npm-x
            """))
        self.assertEqual(len(found), 1, found)

    def test_a_negated_condition_is_named(self):
        found = check.problems(workflow("""
            - uses: actions/cache/save@v6
              if: ${{ ! (github.ref == 'refs/heads/main') }}
              with:
                path: ~/.npm
                key: npm-x
            """))
        self.assertEqual(len(found), 1, found)

    def test_a_condition_in_an_expression_passes(self):
        self.assertEqual(check.problems(workflow("""
            - uses: actions/cache/save@v6
              if: ${{ github.ref == 'refs/heads/main' && steps.npm-cache.outputs.cache-hit != 'true' }}
              with:
                path: ~/.npm
                key: npm-x
            """)), [])

    def test_a_quoted_action_is_recognised(self):
        found = check.problems(workflow("""
            - uses: 'actions/setup-node@v7'
              with:
                cache: npm
            """))
        self.assertEqual(len(found), 1, found)

    def test_the_combined_cache_action_on_maven_s_repository_is_named(self):
        found = check.problems(workflow("""
            - uses: actions/cache@v6
              with:
                path: ~/.m2/repository
                key: maven-x
            """))
        self.assertEqual(len(found), 1, found)
        self.assertIn("actions/cache@v6", found[0])

    def test_the_combined_cache_action_with_a_dependency_cache_among_its_paths_is_named(self):
        found = check.problems(workflow("""
            - uses: actions/cache@v6
              with:
                path: |
                  mobile/node_modules
                  ~/.npm
                key: npm-x
            """))
        self.assertEqual(len(found), 1, found)

    def test_the_combined_cache_action_on_something_else_passes(self):
        self.assertEqual(check.problems(workflow("""
            - uses: actions/cache@v6
              with:
                path: mobile/android/app/build/outputs/apk/release/app-release.apk
                key: taskfest-dev-apk-x
            """)), [])

    def test_restores_of_one_cache_with_the_same_keys_pass(self):
        restore = """
            - uses: actions/cache/restore@v6
              with:
                path: ~/.npm
                key: npm-frontend-${{ hashFiles('frontend/package-lock.json') }}
                restore-keys: npm-frontend-
            """
        self.assertEqual(check.differing_keys({"a.yml": workflow(restore), "b.yml": workflow(restore)}), [])

    def test_restores_of_one_cache_with_differing_keys_are_named(self):
        found = check.differing_keys({
            "a.yml": workflow("""
                - uses: actions/cache/restore@v6
                  with:
                    path: ~/.m2/repository
                    key: maven-${{ runner.os }}-${{ hashFiles('**/pom.xml') }}
                """),
            "b.yml": workflow("""
                - uses: actions/cache/restore@v6
                  with:
                    path: ~/.m2/repository
                    key: maven-${{ runner.os }}-${{ hashFiles('backend/pom.xml') }}
                """),
        })
        self.assertEqual(len(found), 1, found)
        self.assertIn("maven", found[0])

    def test_npm_caches_of_different_projects_may_differ(self):
        def restore(project):
            return workflow(f"""
                - uses: actions/cache/restore@v6
                  with:
                    path: ~/.npm
                    key: npm-{project}-${{{{ hashFiles('{project}/package-lock.json') }}}}
                """)
        self.assertEqual(check.differing_keys({"a.yml": restore("frontend"), "b.yml": restore("e2e")}), [])

    def test_every_workflow_here_keeps_the_rule(self):
        workflows = pathlib.Path(__file__).parents[1] / "workflows"
        texts = {path.name: path.read_text() for path in sorted(workflows.glob("*.yml"))}
        found = {name: check.problems(text) for name, text in texts.items()}
        self.assertEqual({name: problems for name, problems in found.items() if problems}, {})
        self.assertEqual(check.differing_keys(texts), [])


if __name__ == "__main__":
    unittest.main()
