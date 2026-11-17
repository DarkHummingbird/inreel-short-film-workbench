# Continuity review

## Check layers

Review each scene and shot against adjacent shots and project anchors:

1. Character identity, face, age, appearance, injury, emotion, objective, and knowledge.
2. Costume state, accessories, hairstyle, makeup, dirt, wetness, and damage.
3. Props: ownership, hand, position, orientation, fill level, and state.
4. Screen direction, eyelines, action axis, entrances, exits, and travel direction.
5. Action phase, body pose, hand position, gaze, and motion speed.
6. Geography, scale, background landmarks, foreground occlusion, camera side/direction, and shot-size jumps.
7. Story time, elapsed time, weather, environment motion, and crowd state.
8. Light direction, color, intensity, practical sources, shadows, and exposure.
9. Sound bed, dialogue perspective, music state, and transition sound.
10. Prompt anchors: repeated character, environment, prop, costume, and style facts.
11. First/last-frame handoff: pose, action progress, expression, prop state, screen direction, light, and motion.

## Severity

- `critical`: the shot cannot work, contradicts canon, or cannot join adjacent shots.
- `major`: clearly breaks narrative, motivation, performance, geography, or visual identity.
- `minor`: understandable but visibly reduces finish or consistency.
- `suggestion`: optional improvement without a current defect.

## Report format

Every issue must include `issue_id`, severity, category, scene/shot location, evidence, impact, and executable fix. Do not silently repair source material during review. When evidence is incomplete, mark status `needs-confirmation` rather than asserting a defect.

## Direction checks

Track a character or vehicle's world direction separately from screen direction. A cut may preserve world logic while reversing screen direction; flag it when the spatial bridge is absent. Deliberate disorientation is acceptable only when it supports a stated audience effect.
