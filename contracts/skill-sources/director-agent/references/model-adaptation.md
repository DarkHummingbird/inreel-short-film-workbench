# Model-neutral master and adapter

Keep the approved directing master independent of any vendor or model. An adapter changes execution syntax and load; it does not rewrite dramatic purpose, blocking logic, screen direction, identity anchors, or the intended end state.

## Adapter inputs

Use a declared capability profile when available:

- Prompt length and preferred structure.
- Supported or recommended duration range.
- Reliable action density.
- Camera movement complexity.
- Start-frame and end-frame conditioning.
- Negative-prompt support and syntax.
- Image-to-video availability and reference strength.
- Segment generation and continuation support.

If the profile is unknown, label assumptions and avoid inventing exact limits.

## Adapter output

For each target profile provide:

- `adapter_id` and `target_profile`.
- Prompt length strategy.
- Action-density strategy.
- Recommended duration.
- Camera-complexity strategy.
- Start/end-frame strategy.
- Negative-prompt strategy.
- Whether image-to-video is recommended.
- Whether segmented generation is recommended.
- Adapted prompt and preserved anchors.

## Adaptation rules

1. Preserve the master shot's narrative function and directorial quality.
2. Keep subject, camera, and environment actions separate.
3. Reduce simultaneous motion before deleting a meaningful beat.
4. Prefer image-to-video for identity/composition locks when the profile supports it.
5. Use segmented generation only when the take should remain continuous.
6. Do not claim a platform capability without supplied or verified profile data.
7. Compare adapters against the same master, not against each other's rewritten story.
