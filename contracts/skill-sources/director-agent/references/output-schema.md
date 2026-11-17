# Output schema and Canvas contract

## Choose the schema

- Full package: `schemas/director-output.schema.json`.
- Storyboard-only exchange: `schemas/storyboard.schema.json`.
- Review-only exchange: `schemas/continuity-report.schema.json`.

All schemas use JSON Schema Draft 2020-12 and allow extension fields prefixed with `x_`. Do not rename stable core fields when adapting for Haoink Canvas; add adapter metadata under `x_canvas` or another `x_` key.

Schema versions `1.0.0` and `1.1.0` are accepted. v1.1 additions remain optional so existing v1.0 documents continue to validate.

## Identity

- Use `SC` plus three digits for `scene_id`.
- Use `<scene_id>_SH` plus three digits for `shot_id`.
- Keep IDs unique across the whole document and stable across revisions.
- Use `source_refs` or issue locations to trace decisions to source material when available.

## Null and omission

Use `null` only where the schema permits it. Use an empty array for a known category with no items. Record unresolved decisions in `open_questions`; do not put unresolved-marker text into production fields.

## Durations

Use seconds as positive numbers. `project.target_duration_sec` may be `null` when unknown. Shot duration is always required in structured storyboard output.

## Prompt fields

For full output, each planned shot must contain non-empty `image_prompt`, `video_prompt`, and `negative_prompt`. The video prompt follows the labeled contract in `ai-video-prompting.md`.

## Optional v1.1 shot fields

- `directorial_quality`: dramatic purpose, narrative value, emotional rhythm, blocking, camera language, editing logic, and summary.
- `generation_feasibility`: independent technical risk factors and recommended generation route.
- `revision_decision`: one of keep, delete, merge, split, reorder, or replace, with reasons and revised structure.
- `timeline_beats`: contiguous subject/camera/environment timing whose total equals `duration_sec`.
- `end_state`: explicit final identity, pose, action, composition, camera, and environment state.
- `segment_plan`: generation-only subdivisions of one continuous editorial shot.
- `model_adapter`: one master shot and one or more target-profile variants with preserved anchors.

If any review field is used, provide all three review fields so directorial quality, feasibility, and revision decision remain separate. Do not add optional objects merely to fill the document.

## Canvas mapping

Treat the structure as a hierarchy:

`project → dramatic_analysis/characters → scenes → shots → timeline/segments/adapters → prompts/anchors`

Canvas may render scenes and shots as nodes. `scene_id` and `shot_id` are node keys; segment IDs remain children of their parent shot rather than new edit nodes. `continuity_anchors` are edges/constraints; `transition_in` and `transition_out` are edit relations; review issue locations point back to affected nodes; adapters are alternate execution payloads for the same shot master.

## Validation

Run `python3 scripts/validate_output.py <file>`. The validator checks JSON syntax, schema-required fields and types, IDs, uniqueness, positive durations, narrative function, prompt labels, scene/shot/segment parentage, timeline coverage, segment coverage and handoffs, review completeness, adapter identity, and continuity references.
