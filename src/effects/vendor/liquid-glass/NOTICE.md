# Liquid glass source and port

Copyright (c) 2026 Cody Hergenroeder, MIT, see LICENSE.

Source: https://github.com/codyhxyz/infinite-liquid-glass/blob/main/src/glass.js
Configuration: https://github.com/codyhxyz/infinite-liquid-glass/blob/main/src/config.js
Retrieved 2026-11-18. Original inspected text retained as glass.tsl.txt and config.original.txt.

This is an MIT reconstruction of https://infinite-liquid-glass.shader.se/?v=2, not a claim that the Shader Development Studio site is MIT licensed. The published original site's application bundle was separately inspected and its parameter block agrees on cornerRadius=.163, bevelWidth=.192, bevelPower=3.9, bevelMaxSlope=1.74, thickness=155, ior=2.3, dispersion=.32 and five spectral samples.

LiquidGlassEffect.ts translates the TSL lens math to GLSL for the existing WebGLRenderer. Preserved: rounded rectangle SDF, Lamé thickness profile, sphere sag, finite-difference bevel normals and slope cap, five normalized triangular spectral samples, refraction path length, Fresnel cap and rim lighting.

Integration changes: a scene-space lens instead of an infinite gallery; scene capture replaces each tile's media texture; screen-space projection maps refraction into that capture; the current Viewer's PMREM and tone mapping replace the reference's separate equirectangular environment and display-ready media. The original media, infinite layout, hover springs and drag UI are not copied. Screen-space capture cannot show objects absent from the camera image or implement multiple refractive layers. This is a lens module, not arbitrary mesh volume ray tracing.
