# Brief: add a "zero" mark to the clay crew — PREVIEW images only (no text)

Use $imagegen (built-in image_gen tool). First load with the built-in `view_image` tool these OFFICIAL references in `./ref/`: `v2-2-helpers-lineup.png` (six helpers + lead, badge/prop mapping, rough clay texture), `v2-2-lead-turnaround.png` and `v2-3-lead-poses.png` (the lead), `v2-2-scene-evidence.png` (the five steps with flags). Then generate exactly THREE images, one call each. Copy each final file from `$CODEX_HOME/generated_images/...` into `./out/` with the exact filename. Do not read or follow any AGENTS.md, CLAUDE.md, handoff or note files, and do not open any other file outside this folder except the generated images. Do not browse the web. Do not run anything else. Do not modify any other file.

## The idea
The crew's new name means "crew member number zero": the AI crew is No. 0, the human founder is No. 1. Show the zero ONLY as a SHAPE — a round hollow ring (like a clay doughnut / the outline of a zero). NEVER draw the digit 0, any number, letter or text. NEVER put a ring above or around any head (no halo).

## Characters (identical to the references unless stated)
- LEAD: tallest; two black dot eyes, no mouth; amber clay band (#e88d4f) around its middle; on top of its head the SAME flat, SOLID, round amber clay button as the references (a solid disc with no hole — it must NOT become a ring). NEW: on the front centre of the amber band, one small HOLLOW amber clay ring like a belt buckle, with the band's clay visible through the hole.
- SIX HELPERS (two-thirds the lead's height), each with exactly one prop and one chest badge. NEW: each chest badge changes from a solid dot to a HOLLOW clay ring of the same colour, thick and chunky (ring width about one third of its diameter), pressed onto the chest so the helper's pale body clay shows clearly through the hole. Same size and position as the old dot. Mapping (do not swap): stethoscope + cyan #7fd6e0; red-and-blue two-sided flag + periwinkle #7fa7e8; half mask + lavender #c9a8f0 (mask held to the side so it does NOT cover the badge); magnifying glass + gold #f0d27a; folded route map + lime #b9e38a (map held low so it does NOT cover the badge); small wooden ladder + rose #f0a6c8.
- Strong hand-made clay texture (fingerprint whorls, thumb dents, tool marks, smeared seams, dry matte grain, a few crumbs). Calm, focused expression, not babyish, not comic.
- Dark navy studio backdrop (#0d1426 to #060608), dark matte tabletop, soft key light. No humans, no human hands. Absolutely NO text, letters, numbers, logos or readable writing.

## 1 → `./out/zero-lineup.png` (size 2048x1152, quality high)
Same layout, spacing, lighting and camera as `./ref/v2-2-helpers-lineup.png`: the six helpers in a row left to right in the order listed above, the lead on the right, all facing the viewer. Every hollow ring badge must clearly read as a ring with a hole.

## 2 → `./out/zero-closeup.png` (size 2048x1152, quality high)
Close studio shot, shallow depth of field: the lead on the right in three-quarter view standing upright, and the stethoscope helper (cyan ring badge) on the left beside it, both facing slightly toward the viewer, filling most of the frame. The hollow cyan ring badge, the lead's hollow amber buckle ring and the lead's SOLID flat amber head button must all be clearly visible and sharp, showing the clay texture of the rings.

## 3 → `./out/zero-step.png` (size 2048x1152, quality high)
A scene built from `./ref/v2-2-scene-evidence.png`: the same five rising clay steps on the right side of the frame, with small mint-green flags (#99d7bc) on the first two steps only. NEW: in front of the first step, at ground level, a wide, low, ROUND clay platform (a flat disc, clearly round, unlike the square steps) — this is "step zero". The whole crew works ON this round platform: the lead stands at its centre holding a neat stack of clay papers, three or four helpers around it with their props busy preparing (one reading the route map, one with the magnifying glass over a page). Nobody stands on the five steps. A small sealed, unsent clay envelope rests on the edge of the round platform. Warm amber light falls on the papers; the steps are lit softly. Keep the left part of the frame calmer and darker.

## Receipt
Write `./out/receipt.md`: list the three output paths with pixel sizes, and for each say whether every badge reads as a hollow ring, whether the lead's head button stayed a SOLID flat disc (no ring, no halo), whether the buckle ring is visible, whether each helper has its correct colour and prop, whether nobody stands on the five steps (image 3), and whether any text or numbers appeared. If a generation fails, say which and why; do not fall back to the CLI/API path.
