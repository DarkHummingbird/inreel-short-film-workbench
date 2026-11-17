# Storyboard rules

## Atomic shot rule

One row represents one continuous editorial camera take. Split the row when viewpoint, independent time, or camera setup changes. Do not place a montage or several independent shots in one video prompt. If one continuous take needs several generations, retain the row and attach a `segment_plan`.

## Required fields

Include shot ID, duration, narrative function, dramatic subject, shot size, angle, height, lens intent, position, movement, action, blocking, composition, foreground, background, focus, lighting, sound, transitions, and continuity anchors.

## Coverage rules

- Establish geography before relying on fragmented close coverage, unless deliberate uncertainty is the point.
- Let shot changes correspond to information, tactic, power, emotion, or rhythm changes.
- Use reaction shots only when the reaction changes audience understanding.
- Use inserts only when the object/action carries narrative information.
- Use empties to establish space, time, aftermath, anticipation, or transition—not as decoration.
- Preserve enough handles for editing when a generated shot must join another shot.

## Timing

Estimate duration from the ordered action and comprehension time. Ensure duration is positive. Use contiguous `timeline_beats` when timing matters. For generation limits, first test a locked reference, reduced concurrency, or continuous segment plan; split into new shots only when the editorial structure or audience attention also needs a cut.

## Audit questions

For each row ask: what changes, what is newly visible, why this viewpoint, why this duration, what triggers the cut, and which visual/action/sound element carries the join.
