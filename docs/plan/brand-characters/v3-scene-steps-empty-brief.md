# Brief: edit one brand scene image (remove flags from the steps)

Use $imagegen (built-in image_gen tool) in EDIT mode. Do not use an API key or any CLI fallback. Do not read any project governance file. Work only in the current folder.

First load with the built-in `view_image` tool: `./ref/base.png`. This is the base image.

Generate exactly ONE edited image and keep everything not mentioned exactly as it is: the same camera, composition, framing, canvas proportions, lighting, dark blue background, matte hand-made clay texture, the round clay platform, and all four clay figures with their props, badge colours, faces and positions. The tall figure keeps its amber clay zero on its head, exactly as is. No new objects, no text, no logos, no people, no hands, no money.

The ONLY change: on the staircase of clay blocks on the right, remove the three flags standing on the steps (two mint flags and one amber flag), including their poles. All steps must be completely empty, with clean matte clay tops where the flags stood, matching the surrounding clay texture and lighting. Keep the number, size and position of the steps unchanged. Leave any flag held in a figure's hand as it is.

After it is generated, copy the final file from `$CODEX_HOME/generated_images/...` to `./out/scene-steps-empty.png`. Confirm the file exists and report its size in bytes.

If the built-in tool is unavailable or fails, stop and report the exact error. Do not retry with another method. Do not generate more than one image.

Last message: the output path, byte size, and one sentence on whether the three flags are gone and the figures unchanged.
