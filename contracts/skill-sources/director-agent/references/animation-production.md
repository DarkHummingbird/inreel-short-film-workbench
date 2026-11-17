# AI animation and cinematic generation

Apply this reference only to AI-generated moving images, including stylized AI animation, AI shorts, commercials, music videos, multi-shot work, and film previs. Do not route the task into a traditional 2D animation pipeline.

## Stage for generation

Treat readable pose, silhouette, eye direction, negative space, timing, identity anchors, and first/last-frame state as generation constraints. Identify decisive poses and transitions while keeping the dramatic action readable.

## Build motion beats

Describe anticipation → primary action → settle/recovery when the action needs it. State contact points, balance, weight transfer, prop interaction, secondary motion, and held states. Separate body motion, expression, prop action, camera motion, and environment motion.

## Reuse and continuity

Name reusable sets, camera sides, character identity anchors, costume, props, light states, and environment motion. Prefer locked reference images or image-to-video when identity or composition must remain stable across shots.

## Control generation load

- Limit simultaneous independent actions.
- Make start and end states explicit.
- Treat hands, contact, occlusion, turns, crowds, reflections, fast motion, and complex cloth as risk factors—not automatic prohibitions.
- Split a generation only when the combined risk exceeds a declared model profile or when a hidden handoff can preserve the directing intent.
- Preserve one editorial shot when a continuous take is generated in segments.

## Production recommendation

Recommend one of: single text-to-video task, locked-image-to-video task, segmented continuous generation, separate editorial shots, layered generation/compositing, or manual repair. Give both the directorial reason and the AI-generation reason.
