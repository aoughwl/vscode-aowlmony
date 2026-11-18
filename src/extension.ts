import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import {
  LanguageClient,
  LanguageClientOptions,
  ServerOptions,
  TransportKind,
  State,
} from "vscode-languageclient/node";

let client: LanguageClient | undefined;
let statusBarItem: vscode.StatusBarItem;

// Serialize server lifecycle transitions. VS Code delivers restart and
// config-change events as independent async callbacks; without serialization a
// second event can call startClient() while the first stopClient() is still
// awaiting the old server's shutdown, spawning a NEW server before the old one
// exits — several overlapping servers then compile into one shared cache and
// thrash it. Chaining every stop→start through one promise caps concurrent
// servers at one.
let lifecycleChain: Promise<void> = Promise.resolve();
function serializeLifecycle(op: () => Promise<void>): Promise<void> {
  lifecycleChain = lifecycleChain.then(op, op);
  return lifecycleChain;
}

const HOME = process.env.USERPROFILE || process.env.HOME || "";
const DEFAULT_SERVER = path.join(HOME, "dev", "aowllsp", "bin", "aowllsp.exe");

/** Read the extension's configuration namespace. */
function getConfig(): vscode.WorkspaceConfiguration {
  return vscode.workspace.getConfiguration("aowlmony");
}

/** Server binary: `aowlmony.serverPath`, then $AOWLLSP_EXE, then ~/dev/aowllsp/bin/aowllsp.exe. */
function resolveServerPath(_context: vscode.ExtensionContext): string {
  const configured = getConfig().get<string>("serverPath", "").trim();
  if (configured.length > 0) {
    return configured;
  }
  return process.env.AOWLLSP_EXE || DEFAULT_SERVER;
}

/** initializationOptions for aowllsp. Empty entries are left out so the server discovers the tool itself. */
function buildInitializationOptions(): Record<string, unknown> {
  const c = getConfig();
  const o: Record<string, unknown> = { extraPaths: c.get<string[]>("extraPaths", []) };
  const map: Record<string, string> = {
    aowlmonyExe: "aowlmonyPath",
    aowllensExe: "aowllensPath",
    aowlsuggestExe: "aowlsuggestPath",
    aowlfmtExe: "aowlfmtPath",
  };
  for (const [opt, key] of Object.entries(map)) {
    const v = c.get<string>(key, "").trim();
    if (v) o[opt] = v;
  }
  return o;
}

/** Update the status bar item to reflect the current server state. */
function setStatus(text: string, tooltip: string): void {
  statusBarItem.text = `$(server-process) aowlmony: ${text}`;
  statusBarItem.tooltip = tooltip;
  statusBarItem.show();
}

/**
 * Create (but do not start) a LanguageClient wired to the resolved server
 * binary. Returns undefined and shows an error if the binary is missing.
 */
function createClient(
  context: vscode.ExtensionContext
): LanguageClient | undefined {
  const serverPath = resolveServerPath(context);

  if (!fs.existsSync(serverPath)) {
    vscode.window.showErrorMessage(
      `aowllsp not found at "${serverPath}". ` +
        `Build it with: bash ~/dev/aowllsp/build.sh ` +
        `(or set "aowlmony.serverPath" in your settings).`
    );
    setStatus("stopped", `Server binary not found at ${serverPath}`);
    return undefined;
  }

  const serverOptions: ServerOptions = {
    run: {
      command: serverPath,
      transport: TransportKind.stdio,
    },
    debug: {
      command: serverPath,
      transport: TransportKind.stdio,
    },
  };

  const clientOptions: LanguageClientOptions = {
    documentSelector: [
      { scheme: "file", language: "aowlmony" },
    ],
    initializationOptions: buildInitializationOptions(),
    synchronize: {
      configurationSection: "aowlmony",
    },
    outputChannelName: "aowlmony language server",
  };

  const newClient = new LanguageClient(
    "aowlmony",
    "aowlmony language server",
    serverOptions,
    clientOptions
  );

  // Reflect lifecycle transitions in the status bar.
  newClient.onDidChangeState((event) => {
    switch (event.newState) {
      case State.Starting:
        setStatus("starting", "aowlmony language server is starting…");
        break;
      case State.Running:
        setStatus("running", `aowlmony language server running (${serverPath})`);
        break;
      case State.Stopped:
        setStatus("stopped", "aowlmony language server stopped");
        break;
    }
  });

  return newClient;
}

/** Start the language client, creating it if needed. */
async function startClient(context: vscode.ExtensionContext): Promise<void> {
  if (!client) {
    client = createClient(context);
  }
  if (!client) {
    return;
  }
  setStatus("starting", "aowlmony language server is starting…");
  try {
    await client.start();
  } catch (err) {
    setStatus("stopped", "aowlmony language server failed to start");
    vscode.window.showErrorMessage(
      `Failed to start aowlmony language server: ${String(err)}`
    );
  }
}

/** Stop and dispose the current language client, if any. */
async function stopClient(): Promise<void> {
  if (!client) {
    return;
  }
  const stopping = client;
  client = undefined;
  try {
    await stopping.stop();
  } catch {
    // Ignore; the process may already be gone.
  }
  await stopping.dispose().catch(() => undefined);
}

export async function activate(
  context: vscode.ExtensionContext
): Promise<void> {
  statusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    100
  );
  statusBarItem.command = "aowlmony.restartServer";
  context.subscriptions.push(statusBarItem);
  setStatus("stopped", "aowlmony language server not started");

  // Restart command: full stop + start with a freshly resolved config.
  context.subscriptions.push(
    vscode.commands.registerCommand("aowlmony.restartServer", async () => {
      await serializeLifecycle(async () => {
        await stopClient();
        await startClient(context);
      });
      vscode.window.setStatusBarMessage("aowlmony: language server restarted", 3000);
    })
  );

  // Run the current file: `aowlmony run <file>` in a reused terminal (F6).
  context.subscriptions.push(
    vscode.commands.registerCommand("aowlmony.run.file", async () => {
      const ed = vscode.window.activeTextEditor;
      if (!ed) {
        vscode.window.showWarningMessage("aowlmony: no active file to run.");
        return;
      }
      await ed.document.save();
      const file = ed.document.uri.fsPath;
      const cfg = getConfig();
      const exe = cfg.get<string>("aowlmonyPath", "").trim() || "aowlmony";
      const extra = cfg.get<string[]>("extraPaths", []);
      const q = (v: string) => (/[\s"]/.test(v) ? `"${v}"` : v);
      const paths = extra.map((p) => `--path:${q(p)}`).join(" ");
      const dir = path.dirname(file);
      const term =
        vscode.window.terminals.find((t) => t.name === "aowlmony Run") ??
        vscode.window.createTerminal({ name: "aowlmony Run", cwd: dir });
      term.show(true);
      term.sendText(`${exe === "aowlmony" ? exe : `& ${q(exe)}`} run ${paths} ${q(file)}`.replace(/\s+/g, " ").trim());
    })
  );

  // Clear the LSP's per-file compile caches and restart — a self-heal button if
  // the cache ever gets into a bad state. Removes only the LSP's own dirs
  // (`.aowllsp`), never the user's build cache.
  context.subscriptions.push(
    vscode.commands.registerCommand("aowlmony.clearCache", async () => {
      const folders = vscode.workspace.workspaceFolders ?? [];
      let removed = 0;
      for (const f of folders) {
        for (const sub of [".aowllsp"]) {
          const dir = path.join(f.uri.fsPath, sub);
          try {
            if (fs.existsSync(dir)) {
              fs.rmSync(dir, { recursive: true, force: true });
              removed++;
            }
          } catch {
            // ignore; best effort
          }
        }
      }
      await serializeLifecycle(async () => {
        await stopClient();
        await startClient(context);
      });
      vscode.window.setStatusBarMessage(
        `aowlmony: cleared ${removed} cache dir(s), server restarted`,
        3000
      );
    })
  );

  // Restart automatically when relevant settings change so the new
  // serverPath / aowlmonyPath / extraPaths take effect.
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(async (e) => {
      if (
        e.affectsConfiguration("aowlmony.serverPath") ||
        e.affectsConfiguration("aowlmony.extraPaths") ||
        e.affectsConfiguration("aowlmony.aowlmonyPath") ||
        e.affectsConfiguration("aowlmony.aowllensPath") ||
        e.affectsConfiguration("aowlmony.aowlsuggestPath") ||
        e.affectsConfiguration("aowlmony.aowlfmtPath")
      ) {
        await serializeLifecycle(async () => {
          await stopClient();
          await startClient(context);
        });
      }
    })
  );

  await serializeLifecycle(() => startClient(context));
}

export async function deactivate(): Promise<void> {
  await stopClient();
}
