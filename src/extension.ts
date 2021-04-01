import * as cp from "child_process";
import { Readable } from "node:stream";
import * as path from "path";
import { RipGrep } from "ripgrep-node";
import * as split from "split2";
// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from "vscode";
import { QuickPickItem, window, workspace } from "vscode";

const CONFIG = vscode.workspace.getConfiguration();
const LIMIT = CONFIG.get<number>("vscode-fzf.resultLimit")!;

// TODO best way to get cwd? maybe loop over all workspace roots
const cwd = workspace.workspaceFolders?.[0].uri?.fsPath;
if (!cwd) {
  window.showErrorMessage("You must be in a workspace to run this command");
}

export function activate(context: vscode.ExtensionContext) {
  let disposable = vscode.commands.registerCommand(
    "vscode-fzf.rg",
    async () => {
      const quickPick = window.createQuickPick<Item>();
      quickPick.matchOnDescription = false;
      quickPick.matchOnDetail = true;
      quickPick.placeholder = "Search";
      const items = await populateSearchItems();
      console.log("populateSearch returned", items);
      if (!items) {
        return;
      }
      quickPick.items = items;

      const originalEditor = window.activeTextEditor;
      const originalDoc = originalEditor?.document;
      const originalSelection = originalEditor?.selection;

      let hasAccepted = false;

      quickPick.onDidAccept(async () => {
        hasAccepted = true;
        showDocument(quickPick.selectedItems[0]);
      });

      quickPick.onDidHide(async () => {
        // this gets called even on accept
        // and we obviously don't want to jump back to original location
        // if the user accepted
        if (!originalDoc || hasAccepted) {
          return;
        }

        await window.showTextDocument(originalDoc);
        originalSelection &&
          window.activeTextEditor?.revealRange(originalSelection);
      });

      quickPick.onDidChangeValue(async filter => {
        const items = await populateSearchItems(filter);
        // can roughly assume it won't fail if it didn't fail on the first attempt
        quickPick.items = items!;
      });

      // quickPick.onDidChangeSelection(async items => {
      //   showDocument(items[0], true);
      // });

      quickPick.onDidChangeActive(async item => {
        showDocument(item[0], true);
      });

      quickPick.show();
    }
  );

  context.subscriptions.push(disposable);
}

interface Item extends QuickPickItem {
  // root path
  rootpath: string;
  linenumber: number;
  text: string;
  filepath: string;
}

async function showDocument(item?: Item, preserveFocus = false) {
  if (!item) {
    return;
  }

  const docPath = path.join(item.rootpath, item.filepath);
  const doc = await workspace.openTextDocument(docPath);
  await window.showTextDocument(doc, { preserveFocus });

  const { activeTextEditor } = window;
  if (!activeTextEditor) {
    return;
  }
  const pos = new vscode.Position(~~item.linenumber - 1, 0);
  const range = new vscode.Range(pos, pos);
  activeTextEditor.selection = new vscode.Selection(pos, pos);
  activeTextEditor.revealRange(range, vscode.TextEditorRevealType.Default);
}

async function streamToString(stream: Readable): Promise<string> {
  const chunks: any[] = [];
  return new Promise((resolve, reject) => {
    stream.on("data", chunk => chunks.push(Buffer.from(chunk)));
    stream.on("error", err => reject(err));
    stream.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
  });
}

async function populateSearchItems(filter: string = ""): Promise<Item[]> {
  if (process.platform === "win32") {
    return populateSearchItemsWin(filter);
  }
  return populateSearchItemsUnix(filter);
}

// using alternative implementation for windows as it seems to refuse to
// capture stdout ('data' event is never called)
// although stderr seems to work
// might be rg specific I have no idea anymore
// however, ripgrep-node seems to work on windows
// but it uses execSync and I'd rather keep the old async implementation where it works
async function populateSearchItemsWin(filter: string = ""): Promise<Item[]> {
  if (!filter) {
    return [];
  }

  const useRegex = filter.startsWith("/");
  if (useRegex) {
    filter = filter.substring(1);
  }

  console.log(filter);
  const rg = new RipGrep(filter, cwd!).lineNumber().smartCase().maxCount(10);
  if (!useRegex) {
    rg.fixedStrings();
  }
  rg.run();

  const output = rg.asString();

  if (output.length > 10000) {
    return [];
  }

  return <Item[]>output
    .split("\n")
    .map(parseLine)
    .filter(item => item !== undefined);
}

async function populateSearchItemsUnix(filter: string = ""): Promise<Item[]> {
  return new Promise(async (resolve, reject) => {
    if (!filter) {
      return resolve([]);
    }

    // using a pretty arbitrary idea that a leading `/` indicates regex
    const args = ["--line-number", "--smart-case"];
    const useRegex = filter.startsWith("/");
    if (useRegex) {
      filter = filter.substring(1);
    } else {
      args.push("--fixed-strings");
    }
    args.push(filter);

    const rgExecPath = "rg";

    const child = cp.spawn(rgExecPath, args, {
      cwd,
      stdio: "pipe",
      // this is necessary to make it work on windows
      // but works fine without on linux and osx
      shell: process.platform === "win32",
    });

    child.on("error", () => console.log("failed to spawn rg"));

    // const stderr = await streamToString(child.stderr);
    // console.log("stderr", stderr);
    // const stdout = await streamToString(child.stdout);
    // console.log("stdout", stdout);

    const parsedLines: Item[] = [];

    const stream = child.stdout.pipe(split());
    stream.on("close", () => resolve(parsedLines));
    stream.on("end", () => resolve(parsedLines));
    stream.on("error", () => reject("stream failed"));
    stream.on("readable", () => console.log("stdout is readable"));
    stream.on("data", line => {
      const item = parseLine(line);
      item && parsedLines.push(item);

      if (parsedLines.length >= LIMIT && !stream.destroyed) {
        stream.destroy();
        resolve(parsedLines);
      }
    });
  });
}

function parseLine(line: string): Item | undefined {
  const sep = ":";
  const [filepath, linenumber, ...xs] = line.split(sep);
  const text = xs.join(sep);
  if (!text) {
    return;
  }
  return {
    // todo what to put in label/description/details?
    rootpath: cwd!,
    label: "",
    description: `${filepath}:${linenumber}`,
    detail: text,
    text,
    filepath,
    linenumber: +linenumber,
  };
}

// this method is called when your extension is deactivated
export function deactivate() {}
