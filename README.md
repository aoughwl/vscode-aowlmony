# aowlmony for VS Code

Language support for **aowlmony** (`.aowl` sources): syntax highlighting plus the
[`aowllsp`](https://github.com/aoughwl/aowllsp) language server.

## Features

- Diagnostics, hover, signature help, go to definition / declaration / type / implementation, references, document highlight, rename
- Document and workspace symbols, completion (including member completion), semantic tokens, inlay hints, code lens
- Folding and selection ranges, document links, call and type hierarchy
- Syntax diagnostics and quick fixes (aowlsuggest); formatting when `aowlfmt` is available
- **F6** runs the current file with `aowlmony run`
- Status bar item for the server state; commands `aowlmony: Restart Language Server`, `aowlmony: Run File`, `aowlmony: Clear Language Server Cache & Restart`

## Requirements

- `aowllsp.exe` (build with `bash build.sh` in the aowllsp repo). Found via `aowlmony.serverPath`, `$AOWLLSP_EXE`, or `~/dev/aowllsp/bin/aowllsp.exe`.
- The `aowlmony` driver on `PATH` (or `AOWLMONY_ROOT` / `aowlmony.aowlmonyPath`).
- Optional helpers `aowllens`, `aowlsuggest`, `aowlfmt` next to the server, or set their `aowlmony.*Path` settings.

## Settings

`aowlmony.serverPath`, `aowlmony.aowlmonyPath`, `aowlmony.aowllensPath`, `aowlmony.aowlsuggestPath`, `aowlmony.aowlfmtPath`, `aowlmony.extraPaths`, `aowlmony.trace.server`.

## Build

```sh
npm install
npx vsce package        # -> aowlmony-<version>.vsix
code --install-extension aowlmony-<version>.vsix
```

MIT licensed.
