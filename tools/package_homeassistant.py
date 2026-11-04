"""Build a complete manual-install archive; validate the HACS layout/version."""
import argparse
import json
from pathlib import Path
import zipfile

ROOT = Path(__file__).resolve().parents[1]


def package(output, tag=None):
    component = ROOT / "custom_components/nyssetulee"
    manifest = json.loads((component / "manifest.json").read_text())
    hacs = json.loads((ROOT / "hacs.json").read_text())
    for key in ("domain", "name", "version", "documentation", "issue_tracker", "codeowners"):
        if not manifest.get(key):
            raise ValueError(f"Missing manifest field: {key}")
    if tag and tag != "v" + manifest["version"]:
        raise ValueError("Release tag must match the integration manifest version")
    if hacs.get("content_in_root") or not (component / "frontend/nyssetulee-card.js").is_file():
        raise ValueError("Invalid HACS integration/card layout")
    output = Path(output)
    output.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as archive:
        for path in sorted(component.rglob("*")):
            if path.is_file() and "__pycache__" not in path.parts and path.suffix != ".pyc":
                archive.write(path, path.relative_to(ROOT))
    print(f"Built {output} for Nyssetulee {manifest['version']}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", default="dist/nyssetulee.zip")
    parser.add_argument("--tag")
    args = parser.parse_args()
    package(args.output, args.tag)
