# AI video generation feasibility

Evaluate whether one planned shot can be executed as one generation task. Use a declared model profile when available; otherwise report a model-neutral risk assessment and identify what must be verified.

## Assess the load

Check together:

- Character count and identity similarity.
- Number of simultaneous independent actions.
- Fine hand actions and prop state changes.
- Body contact, object contact, and physical causality.
- Partial or full occlusion and reappearance.
- Turns that hide and reveal face, costume, or props.
- Fast movement, motion blur, and action phase precision.
- Camera motion occurring with subject motion.
- Large changes in angle, scale, depth, or composition.
- Face, hair, costume, prop, and environment consistency.
- Clarity of first and last states.
- Whether duration and motion load fit one generation.

Prompt length is only an adapter concern; it is not a feasibility score.

## Rate and route

Use `high`, `medium`, `low`, or `not-feasible` feasibility. Then recommend one route:

- Single text-to-video generation.
- Locked-reference image-to-video.
- One editorial shot generated in continuous segments.
- Split into independent editorial shots.
- Layered generation/compositing.
- Replace the shot design while preserving its narrative function.

## Avoid blanket splitting

Split only when the shot contains distinct editorial units or cannot preserve identity, causality, spatial logic, and handoff state in one generation. Prefer simplification, a locked start frame, reduced concurrent motion, or a hidden segment handoff when those preserve a valuable continuous shot.

## Feasibility evidence

Report concrete factors and mitigations. Example: “two similar faces cross during a foreground occlusion while the camera orbits” is evidence; “complex prompt” is not.
