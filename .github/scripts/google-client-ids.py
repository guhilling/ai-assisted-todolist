"""
Prints a mobile release's Google client ids for GITHUB_ENV (#607): the variant's web and iOS
clients, taken from its environment's terraform.tfvars -- the ids that environment's backend
accepts as an ID token's audience -- so that the app cannot ask Google for tokens its backend would
refuse, now that qa's clients can be in a Google project of their own, apart from prod's.

    google-client-ids.py qa|prod [terraform.tfvars] >> "$GITHUB_ENV"

An id the file leaves empty is left out; check-mobile-release-settings.sh then names it missing.
"""

import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
NAMES = {"google_client_id": "WEB_CLIENT_ID", "google_ios_client_id": "IOS_CLIENT_ID"}


def main(argv):
    variant = argv[1] if len(argv) > 1 else ""
    if variant not in ("qa", "prod"):
        print(f"No environment for the variant {variant!r}; it is qa or prod.", file=sys.stderr)
        return 2
    tfvars = pathlib.Path(argv[2]) if len(argv) > 2 else (
        ROOT / "deployment/aws-tofu/environments" / variant / "terraform.tfvars")
    # A block comment's lines start like assignments; line comments do not, and need no stripping.
    text = re.sub(r"/\*.*?\*/", "", tfvars.read_text(), flags=re.DOTALL)
    values = dict(re.findall(r'(?m)^\s*(\w+)\s*=\s*"([^"]*)"', text))
    for setting, suffix in NAMES.items():
        if values.get(setting):
            print(f"TASKFEST_{variant.upper()}_GOOGLE_{suffix}={values[setting]}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
