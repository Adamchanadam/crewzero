# Brief: two brand images for a celebration result card

Use $imagegen (the built-in image_gen tool). Do not use an API key or any CLI fallback. Do not read any project governance file. Work only in the current folder.

First load these references with the built-in `view_image` tool: `./ref/lead.png`, `./ref/helpers.png`, `./ref/scene.png`. Use them only for shape, colour and placement. Do not copy their smooth surfaces.

## Shared style (both images)

Matte hand-made clay stop-motion miniatures under soft studio light, shallow depth of field. Visible fingerprint swirls, thumb dents, tool marks, smeared joins, fine cracks, a few clay crumbs. Warm cream-stone clay. Background deep navy to near black (#0d1426 to #060608), dark matte table surface. Wide landscape 16:9. The top quarter of the frame stays dark and quiet.

The flag: pole in amber clay (#e88d4f), small flag in mint clay (#99d7bc).

Never include: text, letters, numbers (the only exception is the clay zero on the lead figure's head), logos, people, human hands, silhouettes, money, coins, trophies, confetti, weapons, neon colour, glossy plastic, sci-fi holograms, halos, readable screens, white light rays.

## Image 1: `./out/cele-top.png`

The moment a real result arrives. Low camera angle.

- Right third, close to the camera: the flat top of one clay step block, with one flag freshly planted in it. Clay crumbs thrown outward, frozen in mid-air. A warm amber glow comes from the base of the flag.
- Left and centre, a little further back and slightly soft: the round clay platform from `scene.png`, with four figures standing on it. Nobody stands on the steps.
  - The lead figure, as in `lead.png`: the largest, amber clay belt with no buckle, a solid amber button-disc on the head with a narrow upright clay zero standing in its middle. It is saluting toward the flag: one hand at the side of the eye, fingers together, palm down or toward the head, elbow out. It must not be a raised open palm and must not be waving.
  - Three smaller pebble-shaped helpers as in `helpers.png`, each with exactly one chest badge and one prop: gold badge with magnifying glass, lime badge with folded route map, rose badge with small ladder. They are frozen in a small happy hop, feet just off the platform. Two black dot eyes, no mouth or one thin line, calm and focused, not babyish.

## Image 2: `./out/cele-milestone.png`

Props only. No figures of any kind.

Close-up of the flat top of one clay step block with one flag planted in it, warm amber light rising behind it, a few crumbs frozen in the air. Further clay steps rise behind it, out of focus. Calm and proud.

## After generating

Copy each final file from `$CODEX_HOME/generated_images/...` to the path above. Confirm both exist and report their sizes in bytes.

If the built-in tool is unavailable or fails, stop and report the exact error. Do not retry with another method. Generate exactly these two images, with no extra variations.

Last message: the two output paths, byte sizes, and one sentence for each on any known deviation from this brief.
