"""
Pins down how check-cors-rule.py reads the attachment bucket's CORS rule from its two homes --
the OpenTofu module and the end-to-end stack's LocalStack init script -- and what counts as a
difference.

Run with:  python3 -m unittest discover -s .github/scripts -p 'test_*.py'
"""

import importlib.util
import pathlib
import unittest

_spec = importlib.util.spec_from_file_location(
    "check_cors_rule", pathlib.Path(__file__).with_name("check-cors-rule.py"))
check = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(check)

TOFU = '''
resource "aws_s3_bucket_cors_configuration" "attachments" {
  bucket = aws_s3_bucket.attachments.id

  cors_rule {
    allowed_origins = ["https://${var.hostname}"]
    allowed_methods = ["PUT", "GET"]
    allowed_headers = ["Content-Type"]
    max_age_seconds = 3600
  }
}
'''

INIT = """
awslocal s3api put-bucket-cors --bucket taskfest-attachments --cors-configuration '{
  "CORSRules": [{
    "AllowedOrigins": ["http://localhost:3000"],
    "AllowedMethods": ["GET", "PUT"],
    "AllowedHeaders": ["content-type"],
    "MaxAgeSeconds": 3600
  }]
}'
"""


class CorsRuleTest(unittest.TestCase):

    def test_reads_the_rule_from_the_tofu_module(self):
        self.assertEqual(check.tofu_rule(TOFU),
                         {"methods": {"PUT", "GET"}, "headers": {"content-type"}, "max_age": 3600})

    def test_reads_the_rule_from_the_init_script(self):
        self.assertEqual(check.localstack_rule(INIT),
                         {"methods": {"PUT", "GET"}, "headers": {"content-type"}, "max_age": 3600})

    def test_the_same_rule_in_another_order_and_case_is_no_difference(self):
        self.assertEqual(check.differences(check.tofu_rule(TOFU), check.localstack_rule(INIT)), [])

    def test_an_extra_method_is_a_difference(self):
        drifted = TOFU.replace('["PUT", "GET"]', '["PUT", "GET", "DELETE"]')
        self.assertEqual(check.differences(check.tofu_rule(drifted), check.localstack_rule(INIT)),
                         ["methods: {'DELETE', 'GET', 'PUT'} in OpenTofu, {'GET', 'PUT'} in LocalStack"])

    def test_a_different_max_age_is_a_difference(self):
        drifted = INIT.replace('"MaxAgeSeconds": 3600', '"MaxAgeSeconds": 600')
        self.assertEqual(len(check.differences(check.tofu_rule(TOFU), check.localstack_rule(drifted))), 1)

    def test_a_rule_that_cannot_be_found_is_an_error(self):
        with self.assertRaises(ValueError):
            check.tofu_rule("no cors here")


if __name__ == "__main__":
    unittest.main()
