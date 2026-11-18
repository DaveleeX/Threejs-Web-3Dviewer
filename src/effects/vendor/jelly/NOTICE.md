Jelly-Baby physics source: https://github.com/scottstts/Jelly-Baby
License: GPL-3.0, retained in LICENSE. These files are not MIT.

Imported soft-body.js, deform-surface.js, orientation-safety.js, constants.js.
Local modification to soft-body.js: import Three core rather than three/webgpu;
select the author's existing JavaScript solver branch instead of the optional
compiled native/WASM acceleration. All elastic, contact, inversion protection,
viscosity, sleep and surface deformation equations are retained.

JellyCage.ts is a local generic voxel/tetrahedral cage adapter for user meshes.
It replaces the original character-specific cage generator. The cage is an
approximation at selectable grid resolution; it cannot infer physical material
boundaries or repair arbitrary open/nonmanifold meshes.

JellyEffect integrates the original solver into the existing viewer. Rendering
currently uses Three MeshPhysicalMaterial, not the original WebGPU thickness/
caustics transport. Therefore this remains an experimental physics integration,
not a claim of matching the full Jelly-Baby optical result.

No project-wide license has been changed. Distribution of a combined derivative
must account for the upstream GPL terms; this source port retains that obligation.
