# AI film director review

Review the directing design without confusing aesthetic value with current generation difficulty.

## Evaluate directorial quality

Write `directorial_quality` for each reviewed shot. Judge:

- Dramatic purpose: what changes or becomes legible.
- Narrative value: why this shot exists rather than being covered elsewhere.
- Emotional rhythm: whether duration, restraint, release, reaction, and cut timing serve the scene.
- Blocking: whether position, movement, distance, eyeline, and power are motivated.
- Camera language: whether size, viewpoint, lens intent, movement, focus, and composition control audience access.
- Editing logic: whether entry, exit, screen direction, information, action, and sound produce a usable cut.

State evidence, impact, and a concise overall assessment. A difficult shot may still have high directorial quality.

## Evaluate feasibility separately

Write `generation_feasibility` only after the directorial judgment. Do not lower directorial quality because a model cannot execute a move reliably. Instead recommend a locked image, simplified motion, hidden handoff, segment plan, compositing, alternate coverage, or model adapter.

## Assign a revision decision

Every reviewed shot receives exactly one decision:

- `keep`: directing and generation route are sound.
- `delete`: the shot duplicates information or damages rhythm.
- `merge`: adjacent shots serve one beat and can become one coherent shot.
- `split`: independent dramatic/viewpoint changes or execution load require separate shots.
- `reorder`: information, power, emotion, or continuity works better in another sequence.
- `replace`: the function is needed but the current design cannot serve it.

For every decision state: problem, impact, director reason, AI-generation reason, revision plan, and revised shot structure. Preserve stable source IDs and give new IDs only to revised output shots.

## Review discipline

Do not recommend a change without explaining both its cinematic consequence and its production consequence. Do not manufacture defects to fill a review object; use `keep` with evidence when the design works.
