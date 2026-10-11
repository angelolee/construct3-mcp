# Upstream integration assessment

Checked on October 11, 2026: local code commit `bd0e8a8` on `codex/construct3-knowledge`; upstream v1.10.0 at `1eb4973e0d032fba794c719b1e3971cf71e188a3`, fetched from `liauw-media/construct3-mcp`.

The upstream contains 32 new commits. Several cover the same repairs as this branch: `behaviorType`, block OR/Else, conditionless events, case clashes, the timelines wrapper and function parameters. It also adds disk synchronization, per-call backup scopes, ID safeguards and CDP runtime tools. Our local knowledge retrieval, exact ACE validation and safe project bootstrap remain distinct additions.

A virtual merge found **13 conflicted files**; no merge or push was performed. Prefer the newer upstream event/state implementations where they overlap, then adapt the knowledge hooks and resolver rather than combine old and new helper implementations blindly. The template builder signature, reader/writer state tracking and index cache behavior have changed.

Preserve this branch's flat lowercase entity paths and virtual-folder support: upstream misses 65 existing entities across the official `date-time`, `glokar` and `level-selection` projects. Local reads load every registered entity in those projects. This is separate from upstream filename-case advisories.

Verification: local 483 tests/build passed; standalone upstream 1,984 tests passed and one skipped across 76 files with canonical `TMPDIR=/private/tmp` and local test sockets permitted. Upstream's static corpus result was 535/538 valid. No combined implementation or runtime acceptance is claimed.

The four added tools passed through a fresh connection targeting the platformer at the migrated knowledge root. They remain absent from this chat's host catalog: its observed running workers did not receive `C3_KNOWLEDGE_PATH`, although the saved configuration has it. A full host restart and subsequent catalog check remain necessary; do not replace this configuration issue with implicit knowledge discovery.

Detailed evidence, conflicts, counts and the recommended integration sequence are in the [knowledge comparison](../../Construct3-Knowledge/upstream-comparison.md). The current local main is unchanged and the feature branch is preserved.
