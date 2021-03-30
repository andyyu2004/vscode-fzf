// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from "vscode";
import * as split from "split2";
import * as cp from "child_process";
import * as path from "path";
import { workspace, window, QuickPickItem } from "vscode";

const CONFIG = vscode.workspace.getConfiguration();
const LIMIT = CONFIG.get<number>("vscode-fzf.resultLimit")!;

export function activate(context: vscode.ExtensionContext) {
  let disposable = vscode.commands.registerCommand(
    "vscode-fzf.rg",
    async () => {
      const quickPick = window.createQuickPick<Item>();
      quickPick.matchOnDescription = false;
      quickPick.matchOnDetail = true;
      quickPick.placeholder = "Search";
      quickPick.items = await populateSearchItems();

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
        quickPick.items = await populateSearchItems(filter);
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

async function populateSearchItems(filter: string = ""): Promise<Item[]> {
  // TODO best way to get cwd? maybe loop over all workspace roots
  const cwd = workspace.workspaceFolders![0].uri.fsPath;
  const rgExecPath = "rg";

  // using a pretty arbitrary idea that a leading `/` indicates regex
  const useRegex = filter.startsWith("/");
  const args = ["--line-number", "--smart-case"];
  if (useRegex) {
    filter = filter.substring(1);
  } else {
    args.push("--fixed-strings");
  }
  args.push(filter);
  const child = cp.spawn(rgExecPath, args, {
    cwd,
  });

  const parsedLines: Item[] = [];
  const stream = child.stdout.pipe(split());
  return new Promise(resolve => {
    stream.on("data", line => {
      const sep = ":";
      const [filepath, linenumber, ...xs] = line.split(sep);
      const text = xs.join(sep);
      if (!text) {
        return;
      }

      parsedLines.push({
        // todo what to put in label/description/details?
        rootpath: cwd,
        label: "",
        description: `${filepath}:${linenumber}`,
        detail: text,
        text,
        filepath,
        linenumber: +linenumber,
      });

      if (parsedLines.length >= LIMIT && !stream.destroyed) {
        stream.destroy();
        resolve(parsedLines);
      }
    });
  });
}

// this method is called when your extension is deactivated
export function deactivate() {}
