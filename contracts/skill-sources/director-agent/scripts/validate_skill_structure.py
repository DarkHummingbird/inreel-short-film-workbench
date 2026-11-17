#!/usr/bin/env python3
"""Validate the Director Agent skill structure and bundled examples."""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

from validate_output import SCHEMA_FILES, infer_kind, validate_document


REQUIRED_REFERENCES = {
    "director-workflow.md", "dramatic-analysis.md", "scene-direction.md",
    "cinematography.md", "blocking-and-performance.md", "storyboard-rules.md",
    "continuity-rules.md", "animation-production.md", "ai-video-prompting.md",
    "output-schema.md", "quality-checklist.md", "director-review.md",
    "generation-feasibility.md", "shot-merge-and-split.md",
    "continuous-shot-planning.md", "multi-shot-continuity.md",
    "model-adaptation.md",
}
EXPECTED_TEMPLATES = {
    "director-report.md", "scene-direction.md", "storyboard-table.md", "video-prompt.md",
}
REQUIRED_V11_EXAMPLES = {
    "v11-dialogue-director-review.json",
    "v11-complex-action-split.json",
    "v11-continuous-shot-segments.json",
    "v11-multi-shot-continuity.json",
    "v11-model-adaptation.json",
}


def parse_frontmatter(text: str) -> tuple[dict[str, str], str]:
    match = re.match(r"\A---\n(.*?)\n---\n(.*)\Z", text, re.DOTALL)
    if not match:
        raise ValueError("SKILL.md must begin with YAML frontmatter delimited by ---")
    values: dict[str, str] = {}
    for line in match.group(1).splitlines():
        if ":" not in line:
            raise ValueError(f"invalid frontmatter line: {line!r}")
        key, value = line.split(":", 1)
        values[key.strip()] = value.strip()
    return values, match.group(2)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("skill_dir", nargs="?", default=".", type=Path)
    args = parser.parse_args()
    root = args.skill_dir.resolve()
    errors: list[str] = []

    skill_path = root / "SKILL.md"
    agent_path = root / "agents" / "openai.yaml"
    for required in (skill_path, agent_path):
        if not required.is_file():
            errors.append(f"missing required file: {required.relative_to(root)}")

    body = ""
    if skill_path.is_file():
        text = skill_path.read_text(encoding="utf-8")
        try:
            metadata, body = parse_frontmatter(text)
            if set(metadata) != {"name", "description"}:
                errors.append("SKILL.md frontmatter must contain only name and description")
            if metadata.get("name") != "director-agent":
                errors.append("SKILL.md name must be director-agent")
            if len(metadata.get("description", "")) < 120:
                errors.append("SKILL.md description is too short to cover triggers")
        except ValueError as exc:
            errors.append(str(exc))
        if "TODO" in text or "[TODO" in text:
            errors.append("SKILL.md contains a placeholder")

    if agent_path.is_file():
        agent_text = agent_path.read_text(encoding="utf-8")
        for needle in ("display_name:", "short_description:", "default_prompt:", "$director-agent"):
            if needle not in agent_text:
                errors.append(f"agents/openai.yaml is missing {needle}")

    references_dir = root / "references"
    present_references = {path.name for path in references_dir.glob("*.md")}
    for name in sorted(REQUIRED_REFERENCES - present_references):
        errors.append(f"missing reference: references/{name}")
    for link in re.findall(r"\]\(([^)]+)\)", body):
        target = (root / link).resolve()
        if not target.exists():
            errors.append(f"SKILL.md link target does not exist: {link}")

    templates_dir = root / "templates"
    present_templates = {path.name for path in templates_dir.glob("*.md")}
    for name in sorted(EXPECTED_TEMPLATES - present_templates):
        errors.append(f"missing template: templates/{name}")
    for name in sorted(present_templates - EXPECTED_TEMPLATES):
        errors.append(f"unexpected/unused template: templates/{name}")
    for path in templates_dir.glob("*.md"):
        if path.stat().st_size < 80:
            errors.append(f"template is too small to be useful: templates/{path.name}")

    schemas: dict[str, dict] = {}
    for kind, name in SCHEMA_FILES.items():
        path = root / "schemas" / name
        try:
            schema = json.loads(path.read_text(encoding="utf-8"))
            schemas[kind] = schema
            if schema.get("$schema") != "https://json-schema.org/draft/2020-12/schema":
                errors.append(f"schemas/{name}: expected Draft 2020-12 declaration")
        except FileNotFoundError:
            errors.append(f"missing schema: schemas/{name}")
        except json.JSONDecodeError as exc:
            errors.append(f"schemas/{name}: invalid JSON at {exc.lineno}:{exc.colno}")

    example_files = sorted((root / "examples").glob("*.json"))
    if len(example_files) < 4:
        errors.append("examples must contain at least four JSON test cases")
    kinds_seen: set[str] = set()
    for path in example_files:
        try:
            document = json.loads(path.read_text(encoding="utf-8"))
            kind = infer_kind(document)
            kinds_seen.add(kind)
            if kind in schemas:
                for message in validate_document(document, schemas[kind], kind):
                    errors.append(f"examples/{path.name}: {message}")
        except (json.JSONDecodeError, ValueError) as exc:
            errors.append(f"examples/{path.name}: {exc}")
    if "director" not in kinds_seen:
        errors.append("examples must include at least one full director output")
    present_example_names = {path.name for path in example_files}
    for name in sorted(REQUIRED_V11_EXAMPLES - present_example_names):
        errors.append(f"missing v1.1 example: examples/{name}")

    placeholder_pattern = re.compile(r"\b(?:TODO|TBD|PLACEHOLDER)\b", re.IGNORECASE)
    for folder in ("references", "templates", "examples", "schemas"):
        for path in (root / folder).glob("*"):
            if path.is_file() and path.suffix in {".md", ".json", ".yaml"}:
                if placeholder_pattern.search(path.read_text(encoding="utf-8")):
                    errors.append(f"placeholder marker found in {path.relative_to(root)}")

    if errors:
        print(f"FAIL: {root} ({len(errors)} error(s))")
        for error in errors:
            print(f"- {error}")
        return 1
    print(f"PASS: {root} is a complete Director Agent skill")
    print(f"Validated {len(present_references)} references, {len(present_templates)} templates, {len(schemas)} schemas, and {len(example_files)} JSON examples")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
