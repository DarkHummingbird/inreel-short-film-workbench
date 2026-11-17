# Shot merge, split, and revision

Treat editorial shots and generation segments as different structures. A shot changes when the edit/viewpoint changes; a segment changes only because one continuous shot must be generated in parts.

## Keep

Keep when the shot has unique narrative value, coherent time/space, a motivated camera plan, and an executable generation route.

## Delete

Delete when it repeats information, explains an already legible emotion, damages rhythm, or has no unique transition or continuity job. State where its essential information moves, if any.

## Merge

Merge adjacent shots when they express one beat, share compatible geography and direction, and the combined camera/action plan remains coherent. Do not merge merely to reduce shot count.

## Split

Split into independent shots when there is a cut, viewpoint reset, time jump, separate dramatic subject, incompatible camera logic, or several actions that require distinct audience attention. Preserve the source shot ID in revision metadata and issue new sequential shot IDs.

For a continuous take that only exceeds one generation's capacity, use a `segment_plan` instead of creating new shot IDs.

## Reorder

Reorder when information release, reaction timing, power change, action matching, screen direction, or sound bridges improve. Re-check all adjacent handoffs.

## Replace

Replace when the narrative function is necessary but the existing viewpoint, action, or movement cannot express it or cannot be adapted without losing the function.

## Revised structure

List each resulting shot with ID, source ID, narrative function, duration, start state, end state, and transition. For merge and split decisions, explicitly map old IDs to new IDs.
