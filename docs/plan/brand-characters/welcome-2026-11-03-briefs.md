# 入門頁「30 秒看懂」生圖指示（2026-11-03）

全部用 Codex 內建生圖。`loop-sweep` 同 `tip-you-decide` 冇採用：前者箭咀方向錯，後者似三選一。

---

# Brief: "See it in 30 seconds" hero artwork for a fictional AI-team mascot world (no text in any image)

Use $imagegen (built-in image_gen tool) with the gpt-image-2 model. First load these four images with the built-in `view_image` tool:
- `./ref/v3-lead-turnaround.png` - the lead character, four views.
- `./ref/v3-lead-poses.png` - the lead's standard poses (working, handing over, salute, sitting).
- `./ref/v3-helpers-lineup.png` - six small helpers with their props and badge colours, lead on the right for scale.
- `./ref/v2-3-scene-handover-salute.png` - target lighting, camera feel and premium mood.

Use the references to keep exactly the same characters, proportions, props, badge colours and rough hand-made look. Then generate exactly SIX new images, one call each, quality high. After each is generated, copy the final file from `$CODEX_HOME/generated_images/...` into `./out/` with the exact filename given. Do not read or follow any AGENTS.md, CLAUDE.md, handoff or note files. Do not open any other file outside this folder except the generated images. Do not browse the web. Do not run anything else. If image generation fails, write the exact error in `./out/errors.txt` and carry on with the next image.

## Characters (apply to every image)
- Material: matte hand-made modelling clay, stop-motion miniature photographed in a studio with shallow depth of field. Visible fingerprint whorls, thumb dents, tool drag marks, smeared seams where limbs join, dry matte grain, tiny hairline cracks, a few clay crumbs near the feet. Never glossy, never plastic, never CGI-smooth.
- Bodies: warm off-white / pale stone pebble or capsule shape; two small black dot eyes; no mouth; stubby arms; tiny feet; calm, focused, composed. Not babyish, not comic.
- LEAD: tallest, about 1.5 x helper height. Plain amber clay band (#e88d4f) round the waist with ragged edges, no buckle. On top of the head a SOLID thick flat amber button (a filled disc, no hole, clearly wider than the zero). Standing upright in the centre of that button is an amber clay DIGIT ZERO: tall narrow oval, height = 1.6 x width, sides thicker than top and bottom, tall narrow slot-shaped hole. It never floats, never lies flat, never circles the head. This is the only character with a zero.
- HELPERS: nothing on top of the head. Each has exactly ONE solid round chest badge dot and exactly ONE prop. Stethoscope = teal #7fd6e0. Red-and-blue small flag = periwinkle #7fa7e8. Half mask = lilac #c9a8f0. Magnifying glass = gold #f0d27a. Folded route map = lime #b9e38a. Small ladder = rose #f0a6c8. Never swap these pairs. Props must not hide the badge.
- SALUTE, whenever the lead is waiting: one hand at the side of the eye, fingers together, palm toward the head, elbow out. Never a raised open palm, never a wave.

## World (apply to every image)
- Deep navy to near-black seamless backdrop (#0d1426 to #060608) and a dark matte tabletop. Soft moody studio key light, warm amber glow (#e88d4f, #ffc18e) on finished work. Cinematic, premium, gallery-quality miniature photography. Rich detail, high contrast, real depth of field.
- World laws: characters work only on the tabletop and never walk out of the door. No letter is ever sent: the envelope stays sealed on the table.
- FORBIDDEN in every image: any text, letters, numbers (only the lead's clay zero), labels, logos, readable screens, humans, human hands, silhouettes of people, neon, glossy plastic, holograms, sci-fi interfaces, halos, weapons, money, trophies.

## The amber clay track (Images 1 and 2)
A slim hand-rolled rope of amber clay lying on the table, gently glowing from within like warm embers. Small clay chevron beads sit on it at intervals, all pointing the same way round the loop, so the direction of travel reads instantly. It passes every station and closes back on itself.

## Image 1 -> `./out/loop-turntable.png` (size 2048x1152)
A round miniature world on a dark circular turntable, seen from a high three-quarter camera so that the whole circle reads as one continuous loop and all four stations are clearly separated, each with empty dark table around it. The whole circle sits in the centre with generous dark margin on every side. The amber track forms a clean, unbroken ring round the turntable and the chevrons run CLOCKWISE. Four stations sit on the ring:
- TOP (12 o'clock), furthest from camera: a small stone arched door standing half open with warm amber light pouring out. A neat stack of paper folders has just been set down on the threshold. No character here.
- RIGHT (3 o'clock): a small workbench with three helpers busy on it: magnifying glass, folded route map, stethoscope, all looking at their work.
- BOTTOM (6 o'clock), nearest to camera and the largest and sharpest subject: the LEAD saluting, with a neat stack of finished documents and a sealed envelope set down on the table in front.
- LEFT (9 o'clock): a single clay document on a small stone plinth with a chunky amber clay tick mark pressed into it, warmly lit. No character here.

## Image 2 -> `./out/loop-sweep.png` (size 2048x1152)
Same story and same four stations, as a wide low cinematic diorama from a low camera angle with strong foreground and background blur. Reading from left to right: LEFT, the arched door with warm light and the stack of folders on the threshold. CENTRE-LEFT, the workbench with the magnifying glass, route map and stethoscope helpers at work. CENTRE-RIGHT and largest, the LEAD saluting with finished documents and a sealed envelope in front. RIGHT, the document on a plinth with the amber tick mark. The amber clay track runs left to right through all four, then curves round the far right and returns along the back of the table behind them to the door, so that it clearly closes into one long oval loop. Chevrons all follow the direction of travel. Keep the top 22% of the frame dark and quiet.

## Image 3 -> `./out/tip-one-door.png` (size 1536x1024)
Close, intimate shot. A stone arched door half open with warm light spilling across the dark table in a long glowing wedge. The LEAD stands beside the door, saluting, facing the camera three-quarter. It feels like an invitation: this door is where every day starts. Nothing else in the frame. Subject centred, dark edges.

## Image 4 -> `./out/tip-you-decide.png` (size 1536x1024)
On the dark table, three clay cards stand on small stands in a neat row, each with a blank surface and a coloured dot. The centre card glows warmly and has a chunky amber tick mark pressed into it. Behind them the LEAD stands saluting with the other helpers small and softly out of focus further back, having stopped work and waiting. The cards are the sharp subject. It reads as: the team has done the work, only the decision is left.

## Image 5 -> `./out/tip-never-sends.png` (size 1536x1024)
A sealed clay envelope with an amber clay seal rests on a small stone plinth in a pool of warm light, in the centre of the frame. A low hand-rolled clay rope on small posts runs in front of the two helpers (route map, ladder) and the LEAD, keeping them a little behind it. They stand with their arms down, simply looking at the envelope and not touching it. Calm, disciplined. The envelope is the sharp subject and the characters are softly out of focus behind.

## Image 6 -> `./out/tip-get-unstuck.png` (size 1536x1024)
A messy, tangled knot of amber clay rope lies on the dark table. Starting from the knot, the rope emerges neatly as one straight glowing line running out toward the right of the frame. The gold-badge helper with the magnifying glass peers closely into the knot while the teal-badge helper with the stethoscope gently listens to it, an endearing, thoughtful moment. The LEAD stands behind them, softly out of focus, holding a small clay lantern with a warm glow. Reads as: stuck is fine, someone comes over and untangles it with you.


---

# Brief: edit one image, keep everything else identical

Use $imagegen (built-in image_gen tool) with the gpt-image-2 model, as an EDIT of an existing image. First load `./out/loop-turntable.png` with the built-in `view_image` tool. Edit that image and copy the final file from `$CODEX_HOME/generated_images/...` to `./out/loop-turntable-v2.png` (size 2048x1152, quality high). Do not overwrite the original. Do not read or follow any AGENTS.md, CLAUDE.md, handoff or note files. Do not browse the web. Do not run anything else. If it fails, write the exact error to `./out/errors-edit.txt`.

## The only change
Remove ALL the chunky chevron / arrow-shaped beads that sit on the glowing amber rope ring. There are four: top-left, top-right, lower-right, lower-left. Where each one was, continue the same smooth glowing amber clay rope so that the ring reads as a plain, clean, continuous rope with no arrowheads anywhere.

## Keep exactly as it is
Same camera, framing, turntable, lighting, colours and depth. The arched door, the stack of folders on its threshold, the workbench and the three helpers with their props and badges, the lead with the amber band, solid button and tall narrow digit zero saluting in the centre, the documents and sealed envelope at the front, the document with the tick on the plinth at the left. Do not move, redraw, add or remove any of them. No text, letters, numbers (other than the lead's clay zero), logos, arrows or labels anywhere.


---

# Brief: one new image, same world

Use $imagegen (built-in image_gen tool) with the gpt-image-2 model. First load `./out/tip-you-decide.png` and `./ref/v3-helpers-lineup.png` with the built-in `view_image` tool, to keep exactly the same characters, cards, material, lighting and camera. Generate exactly ONE new image (size 1536x1024, quality high) and copy the final file from `$CODEX_HOME/generated_images/...` to `./out/tip-three-questions.png`. Do not overwrite anything. Do not read or follow any AGENTS.md, CLAUDE.md, handoff or note files. Do not browse the web. Do not run anything else. If it fails, write the exact error to `./out/errors-cards.txt`.

## What it must read as
"You answer these three, one at a time. The rest waits." It must NOT read as choosing one of three.

## Scene
Same dark table, deep navy backdrop and warm amber light as the reference. In the foreground, sharp and in focus, three identical matte clay cards stand on small stands in a neat row, like three tasks in a queue:
- LEFT card: a chunky amber clay tick pressed into it, softly glowing. Done.
- CENTRE card: the brightest. A chunky amber clay tick pressed into it, glowing warmly. Just done.
- RIGHT card: a plain round empty clay socket in the middle, dimmer, not yet answered.

No coloured dots on the cards. To the right, further back and softly out of focus, a tidy pile of many similar blank cards rests on the table, unlit, set aside. Behind the row, softly out of focus, the lead stands saluting (one hand at the side of the eye, fingers together, palm toward the head, elbow out; never a raised palm), with amber waist band, solid amber button and a tall narrow digit zero on the head. The six helpers stand further back, still, each with exactly one chest badge and their own prop: stethoscope teal, red-and-blue flag periwinkle, half mask lilac, magnifying glass gold, folded map lime, ladder rose.

## Rules
Matte hand-made modelling clay, fingerprint whorls, tool marks, a few crumbs, shallow depth of field, premium stop-motion miniature photography. No text, letters, question marks, numbers (other than the lead's clay zero), labels, logos, humans, human hands, neon, plastic gloss, holograms, halos, money or trophies.
