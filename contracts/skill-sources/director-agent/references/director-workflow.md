# Director workflow

Use this as the mandatory control flow for every mode.

## 1. Input contract

Record:

- Input kind: story, script, scene, shot, reference image, described reference video, or revision.
- AI production format: text-to-video, image-to-video, AI short, AI animation, AI commercial, AI music video, multi-shot video, or AI film previs.
- Target: analysis, treatment, storyboard, shot list, prompt, review, or full package.
- Constraints: duration, aspect ratio, audience, rating, platform, available assets, dialogue, production method, and locked facts.

Create four evidence buckets: explicit fact, reasonable inference, director suggestion, open question. Keep their status visible through the result.

## 2. Decision chain

Run decisions in this order:

1. Drama: why the material exists and what changes.
2. Intent: what the audience should experience and when.
3. Space: geography, positions, paths, distance, eyelines, and power.
4. Performance: visible actions, restraint/release, pauses, breath, gaze, and touch.
5. Camera: information, size, position, height, angle, lens intent, movement, focus.
6. Edit: cut trigger, duration, reaction, continuity, and rhythm change.
7. Image and sound: art, light, color, texture, ambience, action sound, dialogue, music, silence.
8. Production conversion: one generation task per independent shot, or several explicit segments for one continuous editorial shot.
9. Directorial review: judge drama, blocking, camera, rhythm, and edit value.
10. Feasibility review: separately judge generation load, state clarity, identity, motion, and available route.
11. Revision and continuity: assign a shot decision, rebuild structure when needed, then check first/last-frame handoffs.
12. Model adaptation: preserve the master intent while adapting execution to a declared capability profile.

Never reverse steps 3 and 5 merely because the user asks for “cinematic shots.”

## 3. Decision grammar

Express consequential choices as:

`decision → evidence/reason → intended audience effect → production consequence`

Weak: “Use a close-up for emotion.”

Strong: “Withhold frontal close-ups while the character deflects; enter the first frontal close shot on the admission, turning emotional exposure into the visual break and requiring a clean eyeline match from the preceding profile.”

## 4. Scope by mode

- Analysis: prioritize drama, audience experience, macro rhythm, perspective, risks.
- Scene direction: prioritize change, geography, performance beats, camera/edit plan.
- Storyboard: make each shot atomic and traceable to a dramatic function.
- Video prompt: preserve the approved direction; do not reinvent plot or coverage.
- Director review: separate directorial quality from generation feasibility and assign one revision decision per shot.
- Continuous-shot plan: preserve one editorial shot ID and use segment IDs for generation handoffs.
- Model adaptation: keep the master structure and anchors stable across variants.
- Review: report evidence and fixes; do not silently rewrite the source.

## 5. Completion gate

Before delivery, verify that each shot answers: why it exists, why this size, why this viewpoint, why it cuts now, whether one generation can carry it, what its end state is, and how it joins adjacent shots.
