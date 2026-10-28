# Third-party notices

The root [LICENSE](LICENSE) retains the existing MIT notice and copyright attribution to Lustresense, Can Bölük, Stencil Labs, Inc. and Mario Zechner. Publication does not remove or reassign these notices.

## Engine

The engine is derived from [Oh My Pi](https://github.com/can1357/oh-my-pi), pinned in `upstream/PINNED_COMMIT.txt`. canoPi's source patches live in `patches/omp/` and `scripts/patch-omp.mjs`. Upstream source and compiled engine binaries are not vendored in this publication. During engine builds, preserve the exact pinned upstream `LICENSE` and `THIRD-PARTY-NOTICES.txt` as `src-tauri/resources/licenses/LICENSE-OMP.txt` and `THIRD-PARTY-NOTICES-OMP.txt`; include them in any binary distribution. This document does not replace their full texts.

## Desktop and frontend dependencies

`package-lock.json` and `src-tauri/Cargo.lock` enumerate the resolved JavaScript and Rust dependency trees, including React, Vite, Tauri, GSAP, Lucide and their transitive dependencies. Retain the actual dependency licenses/notices for the versions distributed. This is not a complete binary dependency license audit or a claim that every dependency uses MIT.

Font packages include Crimson Text, Plus Jakarta Sans and IBM Plex Mono. Preserve each installed font package's license and attribution when redistributing bundled fonts. Source assets and the source-preservation fixture remain subject to existing notices; no new third-party ownership claim is made.

A binary release requires a separate full notices review of the exact engine, frontend, native libraries and embedded assets shipped.
