# Third-party source notice

Copyright (c) 2026 Theo Tillberg. MIT; see LICENSE in this directory.

Source: https://github.com/ttillberg/codevember-2026/tree/main/12/src
Retrieved 2026-11-18 from main. The retrieval was not commit-pinned; provenance.json records the original content hashes so the exact imported snapshot can be audited.

The original branch asset is stored at public/effects/feather/branch.glb, retrieved from the same project's published 12/branch.glb. Its hash is recorded separately in provenance.json. Distribution retains a copy of LICENSE beside that asset.

Local adaptations (not upstream changes):
- bird/index.ts: make global debug installation opt-in; normal embedding does not write window.__bird.
- bird/motion/flee.ts and hop.ts: remove unused constructor parameter-property modifiers to satisfy this application's noUnusedLocals setting; constructor arguments and behavior unchanged.
- post.ts: expose dispose() for render targets, materials and geometry owned by the session.
- bird/plumageGeometry.ts: export the existing FeatherSpec, Builder and specFromLook without changing their geometry or material attribute calculations, for static user-mesh attachment.

FeatherEffect.ts adapts surface placement to arbitrary static meshes. It samples by world-space area, projects a user comb direction onto the surface, uses the original Builder and optical uniforms, and binds each merged attachment under its source mesh with an inverse initial transform. It is not the source bird's anatomical row placement, fuzz-shell generation or skinning system. It additionally applies the original hinge shader in a MeshDistanceMaterial for point-light shadows.

The application adapter FeatherReferenceSession.ts is outside the vendored source. It composes the reference's rendering components with the Viewer pause/resume lifecycle. It does not include the complete original site UI, ambient audio, insects, feeding interactions or branch sway.
