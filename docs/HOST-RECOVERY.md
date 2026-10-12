# Codex host recovery and native preview acceptance

On October 12, 2026, all four local knowledge/bootstrap tools were verified through actual calls from the original Codex chat, and both post-merge packages passed targeted native Construct previews. The current working branch is `feature/construct3-knowledge`.

## Startup cause and correction

The chat retained `/Users/angelolee/Documents/projects/Construct Projects/Construct3-Knowledge` as its working directory after the project moved to `/Users/angelolee/Documents/projects/Construct3-Knowledge`. The old directory no longer existed. Host logs reported `No such file or directory (os error 2)` while starting Construct and native Editor-control servers. The same error was reproduced with an existing absolute Node executable and that missing cwd; the executable ran normally in the canonical root.

The saved Construct environment already had the correct `C3_KNOWLEDGE_PATH`; there was no tool allow/deny list hiding these tools. Restarting Codex retained the stale chat cwd and repeated the startup failure.

The repair added only an explicit cwd to the existing Construct transport, with a complete local config backup:

```toml
[mcp_servers.construct3]
command = "node"
cwd = "/Users/angelolee/Documents/projects/construct3-mcp"
```

Existing arguments, environment and tool policies were preserved. The optional knowledge feature still requires `C3_KNOWLEDGE_PATH`. [The official configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference) documents the stdio cwd field.

The legacy chat path now contains a real compatibility directory with one README pointing at the canonical project. A symlink was attempted and immediately replaced because the sandbox rejects symlinked writable roots. No project files, examples, database or Git history were moved back or duplicated. The compatibility directory supports the existing chat's shell/native-tool cwd; it is not a second project. Keep it until the chat's execution directory is retargeted through supported app controls.

## Proof

A diagnostic client using the exact saved transport listed 87 tools and called the four new tools. Subsequently, this chat itself called `search_construct_docs`, `search_construct_examples`, `get_ace_contract` and `create_project_from_template` successfully. Bootstrap returned a dedicated canonical-root copy with a matching source hash and `connectionChanged: false`. The chat remained bound to Tower Defense Engine. Native `cua_repl` also recovered and controlled only Construct.

The exact `KnowledgePlatformerMergeVerified.c3p` and `KnowledgeShooterMergeVerified.c3p` artifacts were opened in r495.2 stable. Platformer movement, jump/landing, health 3→2→0 with an extra hit at zero, and R reset to 3 passed. Shooter movement, changed cursor aim and disappearance of the visible enemy after sustained firing passed. Both imports showed only the non-blocking Normalized→Regular Z-axis update for 2D content. Neither project was saved; package, event-sheet and stable rollback hashes remained unchanged.

## Branch and limits

`feature/construct3-knowledge` was fast-forwarded from `66d099a` to the verified merge `e2fe2a8`; the integration branch was then deleted. Main remains at `6957fcb`. The old source commit remains reachable as a merge parent; use its commit ID for a detached rollback rather than the now-advanced feature branch. No implementation code changed, so the matching 2,046-test/corpus evidence remains current. No remote push was performed.

These are targeted desktop previews. Exact shot cadence, direct projectile visuals, platformer drop-through, full level traversal, other devices and export behavior were not instrumented or repeated. Original example statuses were not upgraded. [Knowledge recovery report](../../Construct3-Knowledge/host-recovery.md) records actual host calls, observations, screenshot hashes and reproduction.
