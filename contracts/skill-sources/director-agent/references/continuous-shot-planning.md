# Continuous-shot segment planning

Preserve one editorial shot while dividing its generation into compatible segments. Use segment IDs such as `SC001_SH001_SG01`; do not create a fake cut or new shot merely because generation is segmented.

## Plan the master take

Define:

- `camera_path`: position, direction, height, speed, turns, and stops across the full take.
- `subject_path`: position, facing, speed, interaction, and action state.
- `focus_transitions`: subject priority and transition trigger.
- `composition_changes`: how framing evolves without an edit.
- `occlusion_points`: intentional or unavoidable cover.
- `hidden_cut_points`: moments where a generation handoff can be concealed.
- `start_anchor` and `end_anchor`: complete identity, pose, space, camera, light, and environment states.

## Choose handoff points

Prefer a stable or reproducible frame: full occlusion, foreground wipe, dark frame, fast pan blur, static held composition, subject exit/re-entry, or locked object close-up. A handoff must serve or at least not damage the directing plan.

## Specify every segment

Include start/end seconds, starting frame, subject position and facing, current action state, camera position, camera movement, environment and light, ending frame, and next handoff anchor. The next segment must begin from the same anchor.

Segments must be contiguous, cover the full shot duration, and match `segment_count`. `segment_handoffs` should describe the joins between adjacent segments, not duplicate the overall start/end anchors.

## Preserve continuity

Lock character identity, face, hair, costume, prop state, action phase, screen direction, camera side, focal priority, light direction, time, weather, and environment layout at every join. Report visible discontinuity risk even when a hidden cut is available.
