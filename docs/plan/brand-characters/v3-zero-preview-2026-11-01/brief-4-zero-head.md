# Brief 4: make the head ornament read as the NUMBER zero, not the letter o — PREVIEW images only

Use $imagegen (built-in image_gen tool). First load with the built-in `view_image` tool: `./ref/v2-2-helpers-lineup.png` (official characters, badge/prop mapping, rough clay texture), `./ref/v2-2-lead-turnaround.png` (the lead) and `./out3/crown-lineup.png` (the previous attempt). Then generate exactly THREE images, one call each. Copy each final file from `$CODEX_HOME/generated_images/...` into `./out4/` with the exact filename. Do not read or follow any AGENTS.md, CLAUDE.md, handoff or note files, and do not open any other file outside this folder except the generated images and `./out3/crown-lineup.png`. Do not browse the web. Do not run anything else. Do not modify any other file.

## What was wrong last time (`./out3/crown-lineup.png`)
1. The round ring reads as the LETTER "o" (or a hanging loop / keyring / ornament hook), not the NUMBER zero.
2. The helpers wrongly got an amber disc under their ring; only the lead has the amber flat button.
3. The ring sat on a little neck like a hanging loop.

## The fix: a clay NUMBER ZERO standing on the head
- Shape: a TALL, NARROW OVAL ring, like the digit zero in a sturdy typeface: height about 1.6 times its width, sides thicker than the top and bottom, with a tall narrow oval hole through which the dark background shows. It must clearly read as the number zero, not the letter o and not a circle.
- Mounting: it stands upright, facing the viewer, its bottom pressed directly into the top of the head (no neck, no loop, no stem, no disc for the helpers), with a short smeared clay seam where it joins. It must never float, never lie flat, never circle the head (no halo).
- Size: height about 40% of the helper's head height.
- Colour: each helper's zero is its own identity colour. The lead keeps its flat, SOLID amber button exactly as in the references (wider than the zero, clearly visible as a disc), and an amber zero stands in the centre of that button.
- Hand-made clay, same rough texture as the bodies (fingerprints, thumb dents, tool marks), matte. It is a sculpted clay object, not printed text.

## Characters (otherwise identical to the references)
Two black dot eyes, no mouth, calm focused expression. Six helpers (two-thirds the lead's height), each with exactly one prop and one SOLID round chest badge dot: stethoscope + cyan #7fd6e0; red-and-blue two-sided flag + periwinkle #7fa7e8; half mask + lavender #c9a8f0 (held to the side, not covering the badge); magnifying glass + gold #f0d27a; folded route map + lime #b9e38a; small wooden ladder + rose #f0a6c8. Lead: tallest, amber band (#e88d4f) with no buckle. Dark navy studio backdrop (#0d1426 to #060608), dark matte tabletop, soft key light. No humans, no human hands. No text, letters, logos or other numbers anywhere; the only number-like shape allowed is the clay zero on each head.

## 1 → `./out4/zero-head-lineup.png` (size 2048x1152, quality high)
Same layout, spacing, lighting and camera as `./ref/v2-2-helpers-lineup.png`: six helpers left to right in the order above, the lead on the right, all facing the viewer, each with its tall clay zero on the head.

## 2 → `./out4/zero-head-slashed-lineup.png` (size 2048x1152, quality high)
Exactly the same as image 1, but every zero is a "slashed zero" like on a computer keyboard or code font: one short diagonal clay bar crossing inside the oval hole from lower-left to upper-right, joined to the inner edges. Same colours.

## 3 → `./out4/zero-head-closeup.png` (size 2048x1152, quality high)
Close studio shot, shallow depth of field, leaving room above the heads: on the left the stethoscope helper with the plain tall cyan zero (as in image 1); in the middle the magnifying-glass helper with the slashed gold zero (as in image 2); on the right the lead with its amber zero standing on its solid flat amber button. All facing the viewer.

## Receipt
Write `./out4/receipt.md`: list the three output paths with pixel sizes, and for each say whether the head shape reads as the number zero (tall oval) rather than a round o or a loop, whether it is pressed directly into the head with no neck or disc on the helpers, whether the lead's solid flat button is still clearly visible, whether colours and props are correct, and whether any other text or numbers appeared. If a generation fails, say which and why; do not fall back to the CLI/API path.
