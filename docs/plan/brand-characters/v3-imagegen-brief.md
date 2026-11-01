# v3 參考圖生圖紀錄（2026-11-01，零號造型版本 A）

四張正式參考圖：`v3-lead-turnaround.png`、`v3-lead-poses.png`、`v3-helper-turnaround.png`、`v3-helpers-lineup.png`。創辦人 2026-11-01 批核（「批，出場景圖」）。

做法（全部用 Codex 內建生圖，冇用 API 金鑰）：

1. 第五輪（brief 5）：以 v2.2／v2.3 參考圖重出四張，每位成員頭頂都有 0。問題：統籌扁鈕變成空心圈；統籌轉身圖個 0 變咗青色。
2. 第六輪（brief 6，改圖）：統籌扁鈕改返實心厚泥餅；轉身圖個 0 改返琥珀色。
3. 第七輪（brief 7，改圖）：創辦人揀版本 A（只有統籌戴 0），將成員兩張圖頭頂嘅 0 拎走。
4. 後製收窄：三輪生圖出嚟嘅 0 高闊比只有 1.1 至 1.4，所以用本機程式將統籌每個 0 以中線為準橫向收窄，兩邊用左右背景逐行補返。收窄後逐個量度，11 個 0 嘅高闊比喺 1.57 至 1.65 之間。側面圖嘅 0 係打側薄片，唔使改。
5. 細尺寸比較：`v3-small-52px-compare.png`（上行 v2.2、下行 v3，各放入 64px 同 52px 方格，放大三倍）；`v3-lead-small-52px-compare.png`（統籌全身同半身，64px 同 52px）。結論：統籌全身縮到 52px 時 0 太細，產品細圖用半身。

以下係三輪生圖指示原文。

---

# Brief 5: official character model sheets with the clay NUMBER ZERO on every head (no text)

Use $imagegen (built-in image_gen tool). First load these images with the built-in `view_image` tool:
- `./ref/v2-2-lead-turnaround.png` — the lead coordinator, four views (layout, proportions, rough clay texture).
- `./ref/v2-3-lead-poses.png` — the lead's four standard poses.
- `./ref/v2-2-helper-turnaround.png` — the shared helper body, four views, with the lead on the right for scale.
- `./ref/v2-2-helpers-lineup.png` — six helpers with their props and badge colours, the lead on the right.
- `./ref/zero-shape-target.png` — the TARGET SHAPE of the clay zero (the cyan one). Copy only the zero's shape. Ignore the small beige lump under it: that lump is wrong and must not appear.

Use the references ONLY to keep the same characters, proportions, props, poses, layout, camera, lighting and rough hand-made clay texture. Then generate exactly FOUR new images, one call each. After each is generated, copy the final file from `$CODEX_HOME/generated_images/...` into `./out5/` with the exact filename given. Do not read or follow any AGENTS.md, CLAUDE.md, handoff or note files, and do not open any other file outside this folder except the generated images. Do not browse the web. Do not run anything else. Do not modify any other file.

## The clay zero (applies to every figure in every image)
- It is the DIGIT ZERO "0", never the letter "o" and never a round ring. Outer shape: a TALL, NARROW upright oval, height = 1.6 x width. The sides are thicker than the top and bottom. The hole is a tall, narrow vertical slot-shaped oval (much taller than wide) through which the dark background shows. All zeros in one image have the same proportions; none may be rounder than the others.
- Height of the zero is about 40% of the head height.
- It stands upright on the very top of the head with its flat face toward the camera in front views. It never floats, never lies flat, never tilts, never circles the head (no halo).
- HELPERS: the bottom of the zero is pressed straight into the top of the head. The only join is a tiny smear of the zero's own coloured clay. There is NO base, NO disc, NO collar, NO pedestal, NO neck, NO raised beige mound under the zero. The top of the helper's head stays a smooth dome right up to the zero.
- LEAD: a flat, SOLID round amber button (#e88d4f) sits on top of the head exactly as in the references, clearly wider than the zero (about 2.5 x the zero's width) so the button is plainly visible as a disc. An amber zero stands upright in the CENTRE of that button.
- The zero is hand-made clay with the same rough texture as the bodies: fingerprint whorls, thumb dents, tool marks, matte. It is a sculpted object, not printed text.

## Keep unchanged (all images)
Warm off-white / pale stone clay bodies; two small black dot eyes; no mouth; stubby arms; tiny feet; calm, focused, composed (not babyish, not comic). Strong hand-made clay texture: visible fingerprint ridges on heads, bellies and backs; thumb dents; tool drag marks; smeared seams where arms and feet join; dry matte grainy surface with tiny pores and a few hairline cracks; a few tiny clay crumbs near the feet. Lead: tallest; plain amber clay band (#e88d4f) wrapped round the waist with ragged edges and NO buckle, NO clasp, NO knot, NO extra piece on the band. Helpers about two-thirds of the lead's height, each with exactly ONE solid round chest badge dot (a flat filled disc, never a ring). Plain seamless dark navy backdrop (#0d1426 to #060608), matte dark floor, soft even studio lighting. No humans, no human hands, no halos. No text, letters, logos, labels or other numbers anywhere; the only number-like shapes allowed are the clay zeros on the heads.

## Image 1 → `./out5/v3-lead-turnaround.png` (size 2048x1152, quality high)
Lead coordinator, same layout as `./ref/v2-2-lead-turnaround.png`: front, three-quarter front, exact side profile, back. Front view: the zero faces the camera. Three-quarter view: the zero is seen at the same angle as the body. Side profile: the zero is seen edge-on as a thin upright clay slab standing on the centre of the button (button seen edge-on as a thin disc); only the near eye is visible as one dot near the front edge of the head, the far eye completely hidden; the near arm is a short stub hanging straight down flat against the body, tip pointing to the floor, NOT sticking forward. Back view: the zero seen from behind, still a tall narrow oval on the button. The band wraps fully round in every view.

## Image 2 → `./out5/v3-lead-poses.png` (size 2048x1152, quality high)
Lead coordinator, same four poses and layout as `./ref/v2-3-lead-poses.png`: (1) working at a tiny clay desk sorting papers; (2) handing a finished stack of papers toward the viewer with both hands; (3) SALUTE while waiting: one hand at the side of the eye, fingers together, palm facing down or toward the head, elbow out to the side — NOT a raised palm facing forward, NOT a wave; a small sealed, unsent envelope lies on the floor beside it; (4) sitting calmly on a small clay block, hands resting, waiting. The amber zero on the solid amber button appears in all four poses.

## Image 3 → `./out5/v3-helper-turnaround.png` (size 2048x1152, quality high)
Same layout as `./ref/v2-2-helper-turnaround.png`: one helper with no prop shown front, three-quarter front, exact side profile, back; plus the lead in front view on the far right for scale. The helper's chest badge and its zero are both in one neutral placeholder clay colour, light warm grey (#cfc6b8), slightly darker than the body so they are clearly visible. Side profile: only ONE eye visible; the badge seen edge-on as a thin disc; the near arm hangs straight down; the zero seen edge-on as a thin upright slab pressed straight into the top of the head with no base. Back view: the zero seen from behind. The lead on the right has its amber zero on its solid amber button.

## Image 4 → `./out5/v3-helpers-lineup.png` (size 2048x1152, quality high)
Same layout, spacing, camera and lighting as `./ref/v2-2-helpers-lineup.png`, all facing the viewer. Six helpers left to right, each with its own prop, its solid chest badge dot and a tall clay zero in the SAME colour as its badge: (1) stethoscope + cyan #7fd6e0; (2) small two-sided flag, red on one side and blue on the other + periwinkle #7fa7e8; (3) half mask (masquerade style, upper half of a face only, eye holes, no mouth part), held out to the side so it does NOT cover the badge + lavender #c9a8f0; (4) magnifying glass + gold #f0d27a; (5) folded route map, held low so it does NOT cover the badge + lime #b9e38a; (6) small wooden ladder + rose #f0a6c8. The lead coordinator stands at the far right for scale with its amber zero on its solid amber button. Every helper zero is as tall and narrow as the target shape, with no base under it.

## Receipt
Write `./out5/receipt.md`: list the four output paths with pixel sizes, and for each image say honestly whether (a) every zero reads as the digit zero (tall narrow oval, narrow slot hole) and none is rounder than the others, (b) helper zeros have no base, disc or mound under them, (c) the lead's solid flat amber button is clearly visible and wider than the zero, (d) the band has no buckle, (e) side views show one eye and a hanging arm, (f) the salute is a salute and not a raised palm, (g) badge colours and props match the list, (h) any other text or numbers appeared. If a generation fails, say which and why; do not fall back to the CLI/API path.

---

# Brief 6: EDIT four model sheets — fix the lead's button (solid puck, not a ring)

Use $imagegen (built-in image_gen tool) in EDIT mode. This is a correction round: keep everything not mentioned exactly as it is.

First load with the built-in `view_image` tool:
- `./ref/v2-2-lead-turnaround.png` — shows the CORRECT lead button: a thick, solid, flat round amber clay puck sitting on top of the head. Its thickness is about one third of its diameter and its top face is completely filled amber clay.
- `./out5/v3-lead-turnaround.png`, `./out5/v3-lead-poses.png`, `./out5/v3-helper-turnaround.png`, `./out5/v3-helpers-lineup.png` — the four images to edit.

Do not read or follow any AGENTS.md, CLAUDE.md, handoff or note files, and do not open any other file outside this folder except the generated images. Do not browse the web. Do not run anything else. Do not modify any other file. After each edit, copy the final file from `$CODEX_HOME/generated_images/...` into `./out6/` with the exact filename given. Do not overwrite anything in `./out5/`.

## What is wrong in all four out5 images
The lead coordinator's amber button has turned into a thin washer / ring / doughnut with the zero rising out of its hole. That is forbidden: the button must never look like a ring.

## The correct lead button (all edits)
The same solid clay puck as in `./ref/v2-2-lead-turnaround.png`, same diameter and thickness: a thick, flat, round amber (#e88d4f) clay puck, like a big coat button or a thick cookie, resting on the top of the head. Its top face is unbroken, filled amber clay — NO hole, NO ring, NO torus, NO raised rim. The amber zero's foot is pressed into the middle of that solid top face with a small smeared seam; the puck is clearly wider than the zero's foot so the puck's solid top surface is visible on both sides of the zero. Rough hand-made clay texture, matte, slightly ragged edge.

## Edit 1 → `./out6/v3-lead-turnaround.png`
Edit `./out5/v3-lead-turnaround.png`. Change (a) every zero from cyan to amber #e88d4f, same shape and size; (b) every button to the solid puck described above (side view: the puck is seen edge-on as a short thick amber cylinder, the zero standing on its middle as a thin upright slab). Keep the body, eyes, band, arms, feet, poses, layout, lighting and texture unchanged.

After edit 1 is done, load the new `./out6/v3-lead-turnaround.png` with `view_image` and use its button as the lead reference for edits 2–4.

## Edit 2 → `./out6/v3-lead-poses.png`
Edit `./out5/v3-lead-poses.png`. Change ONLY the lead's button in all four poses to the solid puck. Keep the zeros, poses, salute, desk, papers, envelope, sitting block, layout, lighting and texture unchanged.

## Edit 3 → `./out6/v3-helper-turnaround.png`
Edit `./out5/v3-helper-turnaround.png`. Change (a) the lead's button (right) to the solid puck; (b) the helper's chest badge and its zeros to plain off-white clay a shade lighter than the body, like the blank badge in `./ref/v2-2-helper-turnaround.png`; (c) if any zero looks rounder than a tall narrow digit zero (height 1.6 x width, narrow vertical slot hole), make it that narrow. Keep the helper's four views, side-profile single eye, hanging arm, layout, lighting and texture unchanged.

## Edit 4 → `./out6/v3-helpers-lineup.png`
Edit `./out5/v3-helpers-lineup.png`. Change ONLY the lead's button (far right) to the solid puck. Keep every helper, prop, badge, zero, colour and position unchanged.

## Rules that still apply
No humans, no human hands, no halos. No text, letters, logos or other numbers; the only number-like shapes are the clay zeros. The lead's band stays a plain band with no buckle.

## Receipt
Write `./out6/receipt.md`: list the four output paths with pixel sizes, and for each say honestly whether the lead's button is now a solid puck with no hole or ring visible, whether anything else changed that should not have, and (edit 1) whether all zeros are amber. If an edit fails, say which and why; do not fall back to the CLI/API path.

---

# Brief 7: only the lead wears the zero — remove the zeros from the helpers (no text)

Use $imagegen (built-in image_gen tool) in EDIT mode. First load with the built-in `view_image` tool: `./out6/v3-helpers-lineup.png`, `./out6/v3-helper-turnaround.png` (the two base images; if either does not exist, use the same filename in `./out5/` instead and say so in the receipt), `./ref/v2-2-helpers-lineup.png` and `./ref/v2-2-helper-turnaround.png` (these two show the helpers' heads with nothing on top).

Make exactly TWO edits, one call each. In every edit keep the LEAD coordinator (far right) completely unchanged, including its amber zero standing on its solid amber button. Keep every helper's body, eyes, chest badge, prop, colour, position, the layout, lighting and rough clay texture unchanged. Change ONLY the top of the helpers' heads. After each edit, copy the final file from `$CODEX_HOME/generated_images/...` into `./out7/` with the exact filename given. Do not read or follow any AGENTS.md, CLAUDE.md, handoff or note files, and do not open any other file outside this folder except the generated images. Do not browse the web. Do not run anything else. Do not modify any other file.

## Edit 1 → `./out7/v3-helpers-lineup.png`
Base: `v3-helpers-lineup.png`. Remove the zero from all six helpers. The top of each helper's head is a plain smooth clay dome with nothing on it, exactly like `./ref/v2-2-helpers-lineup.png`. No seam, no stub, no coloured smear, no mark where the zero was.

## Edit 2 → `./out7/v3-helper-turnaround.png`
Base: `v3-helper-turnaround.png`. Remove the zero from the helper in all four views (front, three-quarter, side, back). The top of the head is a plain smooth clay dome, exactly like `./ref/v2-2-helper-turnaround.png`. No seam, no stub, no mark.

## Rules that still apply
No humans, no human hands, no halos. No text, letters, logos or numbers anywhere except the lead's clay zero. The lead's band has no buckle.

## Receipt
Write `./out7/receipt.md`: list the two output paths with pixel sizes and which base images were used, and for each edit say honestly whether only the helpers' heads changed, whether any trace of the zero remains, and whether the lead (zero on solid button) is unchanged. If an edit fails, say which and why; do not fall back to the CLI/API path.

