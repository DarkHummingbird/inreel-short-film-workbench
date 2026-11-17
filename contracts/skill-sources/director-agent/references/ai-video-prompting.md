# AI image and video prompting

## Preserve directing intent

Convert an approved shot; do not invent a new shot. Keep prompts model-neutral and separate reusable continuity anchors from shot-specific action.

## Image prompt blocks

Provide `visual_prompt`, `subject_prompt`, `action_prompt`, `camera_prompt`, `environment_prompt`, `lighting_prompt`, `style_prompt`, `continuity_prompt`, and `negative_prompt`. Describe a single frame state and avoid temporal contradictions.

## Video prompt contract

Every video prompt must explicitly include:

1. `Duration`: positive seconds.
2. `Start`: initial composition, pose, prop state, gaze, light, and environment.
3. `Subject action`: ordered actions with restrained concurrency.
4. `Camera`: initial position plus triggered path, speed, direction, and stop; say static when appropriate.
5. `Environment`: only relevant independent motion.
6. `End`: final composition, pose, gaze, prop state, and camera state.
7. `Handoff anchor`: the element that the next shot can match—action phase, screen direction, eyeline, prop, shape, light, or sound.

Use labeled sentences so validation and downstream adapters can parse the intent. Example skeleton:

`Duration: 5s. Start: ... Subject action: first ... then ... Camera: ... Environment: ... End: ... Handoff anchor: ...`

## Negative prompt

Block likely continuity and motion failures, not generic quality buzzwords. Include unwanted identity drift, costume/prop changes, extra limbs/fingers, gaze reversal, screen-direction reversal, camera jitter, temporal morphing, unintended zoom, lighting change, background replacement, text/watermark, or additional subjects when relevant.

## Complexity test

If one shot contains more than one major character action, one significant camera move, and one environment event, decide which motion serves the beat and remove or split the rest. Never encode multiple cuts in one task.

## Timeline beats

When a shot contains ordered changes, add `timeline_beats`. Make the beats contiguous from `0` to `duration_sec`; their durations must sum exactly to the shot duration. For each beat describe `subject_action`, `camera_action`, `environment_action`, `expression_change`, and `continuity_anchor` separately. Keep each field finite and observable. The final beat must establish the shot's end state and handoff.

Timeline precision is an execution aid, not an invitation to overload the shot. If the timing table reveals several independent viewpoints or cuts, revise the storyboard rather than hiding them inside one prompt.
