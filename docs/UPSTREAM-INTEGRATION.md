# Upstream v1.10.0 integration

The `feature/construct3-knowledge-integration` branch integrates upstream `1eb4973e0d032fba794c719b1e3971cf71e188a3` with the committed local knowledge work. The source branch was renamed from `codex/construct3-knowledge` to `feature/construct3-knowledge` and remains available for rollback. Local main remains at `6957fcb`; no remote push is part of this delivery.

## Retained behavior

- Upstream owns event construction and normalization, editor load rules, case/Unicode name checks, disk synchronization, per-call backups/undo, ID bookkeeping and CDP/runtime lifecycle.
- The shared reader/writer resolver prefers flat lowercase and then flat declared-name files, accepting legacy physical folders when no flat file exists. Existing files retain stored filename spelling. Creation uses a flat lowercase file while registration preserves virtual project-bar folders. Chosen malformed files are not hidden by fallback. Path confinement remains mandatory.
- Missing higher-priority files and the selected file's stamp belong to each bulk-cache snapshot and are replayed into the active call. A concurrent cache refresh cannot erase another call's stale-write evidence. A previously selected file deleted during a call is refused rather than recreated at a different location.
- Optional retrieval, exact ACE validation and safe bootstrap remain distinct local additions. Without `C3_KNOWLEDGE_PATH`, the four knowledge/bootstrap tools are absent. Configured provider failures reject checked writes explicitly.
- Contracts check recursive additions, surviving parameter edits/additions and single-action replacements. Comment/script rows bypass ACE lookup. Canonical function calls use case-normalized signatures, ordered arguments and JSON booleans for boolean parameters. Changed function arguments are checked too. Legacy ACE-owner fields on raw function-call input remain rejected in configured mode; upstream's normalization remains available without knowledge.
- The built-in Functions object, including a renamed `functionsName`, uses the four upstream `FUNCTIONS_OBJECT_ACTION_IDS` contracts stored under System. Owner applicability is enforced: Functions has no System-only ACEs or behaviors, and those four actions cannot be supplied on System.

## Verification

The final build and `git diff upstream/main --check` passed. The staged merge also retains two upstream blank-at-EOF warnings in unrelated files. `env TMPDIR=/private/tmp npm test` passed **2,046 tests across 79 files**, with one test for a case-sensitive filesystem skipped on this case-insensitive Mac. Browser tests exercised upstream runtime control in real headless browsers, including worker mode. Those tests use a test game; they do not establish Construct Editor gameplay acceptance.

The read-only corpus scan passed **538/538 projects**, with zero exceptions, validation errors or registered supported entities lost. This includes `date-time`, `glokar` and `level-selection`, whose 65 flat-file entities the standalone upstream resolver missed. Remaining source advisories are 55 duplicate SIDs, 11 legacy event shapes and one behavior/variable warning across 25 projects. They are preserved rather than suppressed.

The final stdio task run, `MergeVerified`, created, edited and packed fresh official platformer/shooter copies under `/Users/angelolee/Documents/projects/Construct3-Knowledge`. Ten calls included one deliberate nonexistent-ACE rejection. Source inventories, unrelated copied files, original event logic and a stable rollback copy matched their expected bytes/hashes. Writer `.bak` files remain mutable on later calls; the task evidence names the stable recovery copy.

The single fresh final review found four material issues: negative bulk-cache dependencies, boolean/case-normalized function calls, unchecked function argument edits and the built-in Functions owner. Each correction has a regression observed failing before the fix and passing afterward. The final full suite includes them. No other material finding remained in that review.

## Evidence and limits

Current evidence is in [the knowledge integration report](../../Construct3-Knowledge/upstream-integration.md), its execution ledger and reproducible scripts. Originals, generated games/packages, SQLite, dependencies and the old-worktree recovery archive remain outside Git.

Native Construct tools and Editor automation were unavailable in this chat after the app restart. Independent stdio checks and host tool exposure are separate: no claim is made that the four tools appear in this chat or that the newly generated packages received a fresh Editor/gameplay run. Earlier acceptance of pre-merge prototypes remains historical evidence only. Full expression semantics, picking and gameplay coverage remain outside the exact ACE checks.

Rollback: switch the primary checkout to `feature/construct3-knowledge` and rebuild. Preserve the configured knowledge root. The obsolete `codex/construct3-compatibility` worktree has no unique commits; its 91 source files were archived and SHA-256 verified before cleanup. Recovery instructions are in the knowledge report.
