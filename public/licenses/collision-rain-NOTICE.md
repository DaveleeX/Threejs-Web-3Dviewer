Source: https://github.com/ektogamat/threejs-conference

CollisionRainEffect ports createCollisionRain.js and createCollisionHeight.js from
src/world/weather (MIT, Anderson Mancini and Sunag, 2026) from TSL to WebGL GLSL.
The viewer keeps its renderer and postprocessing pipeline. GPU ping-pong textures
replace WebGPU storage buffers; integration is delta-time corrected. The height
camera covers the user's model bounds and is refreshed only when transforms change.
Only source code is adapted. Upstream public textures are not covered by its MIT
license. Splash atlas support accepts a caller-owned five-frame grayscale texture;
without that asset no replacement sprite or pretend splash is rendered.
This is the rain subsystem, not a reproduction of the entire wet city scene.
