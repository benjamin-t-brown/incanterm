"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = void 0;
var vscode = require("vscode");
function activate(context) {
    // 👎 formatter implemented as separate command
    // vscode.commands.registerCommand('extension.format-rpgscript', () => {
    //   const { activeTextEditor } = vscode.window;
    //   if (
    //     activeTextEditor &&
    //     activeTextEditor.document.languageId === 'rpgscript'
    //   ) {
    //     const { document } = activeTextEditor;
    //     const firstLine = document.lineAt(0);
    //     if (firstLine.text !== '42') {
    //       const edit = new vscode.WorkspaceEdit();
    //       edit.insert(document.uri, firstLine.range.start, '42\n');
    //       return vscode.workspace.applyEdit(edit);
    //     }
    //   }
    // });
    var RPGScriptFormatter = /** @class */ (function () {
        function RPGScriptFormatter() {
        }
        RPGScriptFormatter.prototype.format = function (document) {
            var edits = [];
            var indentLevel = 0;
            for (var i = 0; i < document.lineCount; i++) {
                var line = document.lineAt(i);
                var text = line.text;
                var trimmed = text.trim();
                while (trimmed.slice(-1) === ';') {
                    trimmed = trimmed.slice(0, -1);
                }
                var trimmedNoComments = trimmed.replace(/\/\*[\s\S]*?\*\/|([^:]|^)\/\/.*$/gm, '');
                if (trimmedNoComments === '') {
                    continue;
                }
                var incIndent = false;
                if (trimmedNoComments.at(0) === '@' ||
                    trimmedNoComments.at(0) === '#') {
                    indentLevel = 0;
                    incIndent = true;
                }
                if (trimmedNoComments === '}' || trimmedNoComments === '|') {
                    indentLevel--;
                }
                console.log('read line', trimmed, indentLevel);
                var indent = '  '.repeat(indentLevel);
                edits.push(vscode.TextEdit.replace(line.range, indent + trimmed));
                if (incIndent) {
                    indentLevel++;
                }
                else if (trimmed.slice(-1) === '{' || /^\+(?:\^?[A-Za-z_][\w.-]*|\[[A-Za-z_][\w-]*\])\s*=\s*\|$/.test(trimmed)) {
                    indentLevel++;
                }
            }
            return edits;
        };
        return RPGScriptFormatter;
    }());
    // 👍 formatter implemented using API
    vscode.languages.registerDocumentFormattingEditProvider('rpgscript', {
        provideDocumentFormattingEdits: function (document) {
            var formatter = new RPGScriptFormatter();
            return formatter.format(document);
        },
    });
}
exports.activate = activate;
//# sourceMappingURL=extension.js.map