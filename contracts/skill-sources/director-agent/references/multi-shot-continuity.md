# Multi-shot AI video continuity

Audit every adjacent shot pair and any recurring character, set, costume, prop, or light state. Treat first and last frames as explicit contracts.

## Identity and appearance

Check character identity, facial structure, age, skin features, hair shape/color/part, costume layers and damage, accessories, carried props, and state changes. Distinguish intentional story change from generation drift.

## Action and space

Check world position, screen position, left/right direction, eyeline target, action phase, body/hand state, prop hand and orientation, entrances/exits, axis side, and environment landmarks. State the exact end frame of shot A and start frame of shot B.

## Image conditions

Check light direction/color/intensity, time, weather, atmosphere, background activity, camera direction, shot-size jump, focal priority, motion blur, and depth cues.

## Emotion and motivation

Check emotional progression, knowledge state, objective, tactic, and performance energy. A technically matching face with an incompatible emotional state is a continuity failure.

## Handoff report

For each join record:

- From/to shot IDs.
- Match anchors: identity, pose/action, direction, prop, eyeline, space, light, sound.
- Mismatches with evidence and severity.
- Repair location: regenerate end, regenerate start, bridge shot, reorder, adapter change, or editorial concealment.

Do not use vague “keep consistent” instructions. Write reusable anchor values that Haoink Canvas can attach to shot nodes and edges.
