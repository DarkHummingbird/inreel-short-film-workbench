#!/usr/bin/env python3
"""Validate Director Agent JSON without third-party dependencies."""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any


SCHEMA_FILES = {
    "director": "director-output.schema.json",
    "storyboard": "storyboard.schema.json",
    "continuity": "continuity-report.schema.json",
}
VIDEO_LABELS = (
    "Duration:",
    "Start:",
    "Subject action:",
    "Camera:",
    "Environment:",
    "End:",
    "Handoff anchor:",
)


def json_path(parts: list[Any]) -> str:
    result = "$"
    for part in parts:
        result += f"[{part}]" if isinstance(part, int) else f".{part}"
    return result


def resolve_ref(root_schema: dict[str, Any], ref: str) -> dict[str, Any]:
    if not ref.startswith("#/"):
        raise ValueError(f"Only local schema references are supported: {ref}")
    value: Any = root_schema
    for token in ref[2:].split("/"):
        token = token.replace("~1", "/").replace("~0", "~")
        value = value[token]
    return value


def type_matches(value: Any, expected: str) -> bool:
    if expected == "null":
        return value is None
    if expected == "object":
        return isinstance(value, dict)
    if expected == "array":
        return isinstance(value, list)
    if expected == "string":
        return isinstance(value, str)
    if expected == "number":
        return isinstance(value, (int, float)) and not isinstance(value, bool)
    if expected == "integer":
        return isinstance(value, int) and not isinstance(value, bool)
    if expected == "boolean":
        return isinstance(value, bool)
    return True


def validate_schema_node(
    value: Any,
    schema: dict[str, Any],
    root_schema: dict[str, Any],
    path: list[Any],
    errors: list[str],
) -> None:
    if "$ref" in schema:
        validate_schema_node(value, resolve_ref(root_schema, schema["$ref"]), root_schema, path, errors)
        return

    location = json_path(path)
    if "const" in schema and value != schema["const"]:
        errors.append(f"{location}: expected constant {schema['const']!r}")
    if "enum" in schema and value not in schema["enum"]:
        errors.append(f"{location}: value {value!r} is not one of {schema['enum']!r}")

    expected = schema.get("type")
    if expected is not None:
        accepted = expected if isinstance(expected, list) else [expected]
        if not any(type_matches(value, item) for item in accepted):
            errors.append(f"{location}: expected type {' or '.join(accepted)}, got {type(value).__name__}")
            return

    if isinstance(value, str):
        if len(value) < schema.get("minLength", 0):
            errors.append(f"{location}: string is shorter than {schema['minLength']}")
        if "pattern" in schema and re.search(schema["pattern"], value) is None:
            errors.append(f"{location}: value {value!r} does not match {schema['pattern']!r}")

    if isinstance(value, (int, float)) and not isinstance(value, bool):
        if "minimum" in schema and value < schema["minimum"]:
            errors.append(f"{location}: value must be >= {schema['minimum']}")
        if "exclusiveMinimum" in schema and value <= schema["exclusiveMinimum"]:
            errors.append(f"{location}: value must be > {schema['exclusiveMinimum']}")

    if isinstance(value, list):
        if len(value) < schema.get("minItems", 0):
            errors.append(f"{location}: array has fewer than {schema['minItems']} item(s)")
        if schema.get("uniqueItems"):
            serialized = [json.dumps(item, sort_keys=True, ensure_ascii=False) for item in value]
            if len(serialized) != len(set(serialized)):
                errors.append(f"{location}: array items must be unique")
        item_schema = schema.get("items")
        if item_schema:
            for index, item in enumerate(value):
                validate_schema_node(item, item_schema, root_schema, path + [index], errors)

    if isinstance(value, dict):
        properties = schema.get("properties", {})
        required = schema.get("required", [])
        for key in required:
            if key not in value:
                errors.append(f"{location}.{key}: required property is missing")
        for key, child in value.items():
            if key in properties:
                validate_schema_node(child, properties[key], root_schema, path + [key], errors)
                continue
            matching_patterns = [rule for pattern, rule in schema.get("patternProperties", {}).items() if re.search(pattern, key)]
            if matching_patterns:
                for rule in matching_patterns:
                    validate_schema_node(child, rule, root_schema, path + [key], errors)
            elif schema.get("additionalProperties") is False:
                errors.append(f"{location}.{key}: additional property is not allowed")


def infer_kind(document: dict[str, Any]) -> str:
    if "project" in document and "scenes" in document:
        return "director"
    if "scene_id" in document and "shots" in document:
        return "storyboard"
    if "issues" in document and "checked_categories" in document:
        return "continuity"
    raise ValueError("Cannot infer output type; pass --schema director, storyboard, or continuity")


def iter_shots(document: dict[str, Any], kind: str):
    if kind == "director":
        for scene_index, scene in enumerate(document.get("scenes", [])):
            for shot_index, shot in enumerate(scene.get("shots", [])):
                yield scene.get("scene_id"), shot, ["scenes", scene_index, "shots", shot_index]
    elif kind == "storyboard":
        for shot_index, shot in enumerate(document.get("shots", [])):
            yield document.get("scene_id"), shot, ["shots", shot_index]


def validate_time_partition(
    items: Any,
    duration: Any,
    location: str,
    label: str,
) -> list[str]:
    errors: list[str] = []
    if not isinstance(items, list) or not items:
        return errors
    if not isinstance(duration, (int, float)) or isinstance(duration, bool):
        return errors
    previous_end = 0.0
    summed_duration = 0.0
    for index, item in enumerate(items):
        if not isinstance(item, dict):
            continue
        start = item.get("start_sec")
        end = item.get("end_sec")
        item_location = f"{location}.{label}[{index}]"
        if not isinstance(start, (int, float)) or isinstance(start, bool):
            continue
        if not isinstance(end, (int, float)) or isinstance(end, bool):
            continue
        if end <= start:
            errors.append(f"{item_location}: end_sec must be greater than start_sec")
        if abs(float(start) - previous_end) > 0.001:
            errors.append(f"{item_location}: starts at {start}, expected contiguous start {previous_end:g}")
        summed_duration += float(end) - float(start)
        previous_end = float(end)
    if abs(summed_duration - float(duration)) > 0.001:
        errors.append(f"{location}.{label}: durations sum to {summed_duration:g}, expected {duration:g}")
    if abs(previous_end - float(duration)) > 0.001:
        errors.append(f"{location}.{label}: final end_sec is {previous_end:g}, expected {duration:g}")
    return errors


def validate_v11_shot(shot: dict[str, Any], duration: Any, location: str) -> list[str]:
    errors: list[str] = []
    review_fields = ("directorial_quality", "generation_feasibility", "revision_decision")
    present_review_fields = [field for field in review_fields if field in shot]
    if present_review_fields and len(present_review_fields) != len(review_fields):
        missing = [field for field in review_fields if field not in shot]
        errors.append(f"{location}: reviewed shots must keep directorial quality, generation feasibility, and revision decision separate; missing {missing}")

    decision = shot.get("revision_decision")
    if isinstance(decision, dict):
        action = decision.get("decision")
        revised = decision.get("revised_shot_structure")
        if isinstance(revised, list):
            if action == "delete" and revised:
                errors.append(f"{location}.revision_decision: delete must produce an empty revised_shot_structure")
            if action == "split" and len(revised) < 2:
                errors.append(f"{location}.revision_decision: split must produce at least two revised shots")
            if action in {"keep", "merge", "replace", "reorder"} and not revised:
                errors.append(f"{location}.revision_decision: {action} must describe the resulting shot structure")

    timeline = shot.get("timeline_beats")
    if timeline is not None:
        errors.extend(validate_time_partition(timeline, duration, location, "timeline_beats"))
        if not str(shot.get("end_state", "")).strip():
            errors.append(f"{location}.end_state: required when timeline_beats are present")

    segment_plan = shot.get("segment_plan")
    if isinstance(segment_plan, dict):
        segments = segment_plan.get("segments")
        segment_count = segment_plan.get("segment_count")
        handoffs = segment_plan.get("segment_handoffs")
        if isinstance(segments, list):
            if isinstance(segment_count, int) and not isinstance(segment_count, bool) and segment_count != len(segments):
                errors.append(f"{location}.segment_plan.segment_count: declares {segment_count}, found {len(segments)} segment(s)")
            errors.extend(validate_time_partition(segments, duration, f"{location}.segment_plan", "segments"))
            expected_prefix = f"{shot.get('shot_id', '')}_SG"
            segment_ids: set[str] = set()
            for index, segment in enumerate(segments):
                if not isinstance(segment, dict):
                    continue
                segment_id = segment.get("segment_id")
                if segment_id in segment_ids:
                    errors.append(f"{location}.segment_plan.segments[{index}].segment_id: duplicate segment ID {segment_id!r}")
                segment_ids.add(segment_id)
                if isinstance(segment_id, str) and not segment_id.startswith(expected_prefix):
                    errors.append(f"{location}.segment_plan.segments[{index}].segment_id: must belong to parent shot {shot.get('shot_id')!r}")
            if isinstance(handoffs, list) and len(handoffs) != max(0, len(segments) - 1):
                errors.append(f"{location}.segment_plan.segment_handoffs: expected {max(0, len(segments) - 1)} handoff(s), found {len(handoffs)}")

    adapter = shot.get("model_adapter")
    if isinstance(adapter, dict):
        if adapter.get("master_shot_id") != shot.get("shot_id"):
            errors.append(f"{location}.model_adapter.master_shot_id: must match the containing shot ID")
        variants = adapter.get("variants")
        if isinstance(variants, list):
            adapter_ids = [item.get("adapter_id") for item in variants if isinstance(item, dict)]
            if len(adapter_ids) != len(set(adapter_ids)):
                errors.append(f"{location}.model_adapter.variants: adapter_id values must be unique")
        anchors = adapter.get("preserved_anchors")
        if isinstance(anchors, list) and not anchors:
            errors.append(f"{location}.model_adapter.preserved_anchors: at least one master anchor is required")
    return errors


def semantic_errors(document: dict[str, Any], kind: str) -> list[str]:
    errors: list[str] = []
    scene_ids: set[str] = set()
    shot_ids: set[str] = set()
    issue_ids: set[str] = set()

    if kind == "director":
        for index, scene in enumerate(document.get("scenes", [])):
            scene_id = scene.get("scene_id")
            if scene_id in scene_ids:
                errors.append(f"$.scenes[{index}].scene_id: duplicate scene ID {scene_id!r}")
            scene_ids.add(scene_id)

    for scene_id, shot, path in iter_shots(document, kind):
        location = json_path(path)
        shot_id = shot.get("shot_id")
        if shot_id in shot_ids:
            errors.append(f"{location}.shot_id: duplicate shot ID {shot_id!r}")
        shot_ids.add(shot_id)
        if isinstance(shot_id, str) and isinstance(scene_id, str) and not shot_id.startswith(scene_id + "_SH"):
            errors.append(f"{location}.shot_id: {shot_id!r} does not belong to parent scene {scene_id!r}")
        duration = shot.get("duration_sec")
        if not isinstance(duration, (int, float)) or isinstance(duration, bool) or duration <= 0:
            errors.append(f"{location}.duration_sec: must be a positive number")
        if not str(shot.get("narrative_function", "")).strip():
            errors.append(f"{location}.narrative_function: must explain why the shot exists")
        prompt = str(shot.get("video_prompt", ""))
        for label in VIDEO_LABELS:
            if label.lower() not in prompt.lower():
                errors.append(f"{location}.video_prompt: missing required label {label!r}")
        match = re.search(r"Duration:\s*([0-9]+(?:\.[0-9]+)?)s", prompt, re.IGNORECASE)
        if match and isinstance(duration, (int, float)) and abs(float(match.group(1)) - float(duration)) > 0.01:
            errors.append(f"{location}.video_prompt: prompt duration {match.group(1)}s does not match duration_sec {duration}")
        if isinstance(shot, dict):
            errors.extend(validate_v11_shot(shot, duration, location))

    issue_groups: list[list[dict[str, Any]]] = []
    if kind == "continuity":
        issue_groups.append(document.get("issues", []))
    elif kind == "director":
        review = document.get("review", {})
        issue_groups.extend(review.get(key, []) for key in ("critical_issues", "major_issues", "minor_issues", "recommendations"))
    for group in issue_groups:
        for issue in group:
            issue_id = issue.get("issue_id")
            if issue_id in issue_ids:
                errors.append(f"$.review/issues: duplicate issue ID {issue_id!r}")
            issue_ids.add(issue_id)
    return errors


def validate_document(document: dict[str, Any], schema: dict[str, Any], kind: str) -> list[str]:
    errors: list[str] = []
    validate_schema_node(document, schema, schema, [], errors)
    errors.extend(semantic_errors(document, kind))
    return errors


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("json_file", type=Path)
    parser.add_argument("--schema", choices=SCHEMA_FILES, help="Schema type; inferred when omitted")
    args = parser.parse_args()

    try:
        document = json.loads(args.json_file.read_text(encoding="utf-8"))
    except FileNotFoundError:
        print(f"ERROR: file not found: {args.json_file}", file=sys.stderr)
        return 2
    except json.JSONDecodeError as exc:
        print(f"ERROR: invalid JSON at line {exc.lineno}, column {exc.colno}: {exc.msg}", file=sys.stderr)
        return 2

    if not isinstance(document, dict):
        print("ERROR: root JSON value must be an object", file=sys.stderr)
        return 2
    try:
        kind = args.schema or infer_kind(document)
    except ValueError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 2

    schema_path = Path(__file__).resolve().parent.parent / "schemas" / SCHEMA_FILES[kind]
    schema = json.loads(schema_path.read_text(encoding="utf-8"))
    errors = validate_document(document, schema, kind)
    if errors:
        print(f"FAIL: {args.json_file} ({len(errors)} error(s))")
        for error in errors:
            print(f"- {error}")
        return 1
    print(f"PASS: {args.json_file} conforms to {schema_path.name} and semantic checks")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
