import { useEffect, useRef } from "react";
import Editor, { loader, type OnMount } from "@monaco-editor/react";
import * as monaco from "monaco-editor/editor/editor.api.js";
import "monaco-editor/language/json/monaco.contribution.js";
import EditorWorker from "monaco-editor/editor/editor.worker.js?worker";
import JsonWorker from "monaco-editor/language/json/json.worker.js?worker";
import type { InputIssue } from "@opscope/core";
import type { Theme } from "@/lib/theme";

// Local-first: Monaco and its workers are bundled, never fetched from a CDN.
self.MonacoEnvironment = {
  getWorker: (_id: string, label: string) => (label === "json" ? new JsonWorker() : new EditorWorker()),
};
loader.config({ monaco });

monaco.editor.defineTheme("opscope-dark", {
  base: "vs-dark",
  inherit: true,
  rules: [
    { token: "string.key.json", foreground: "ECEBF3" },
    { token: "string.value.json", foreground: "C3EF5D" },
    { token: "number", foreground: "B8A8FF" },
    { token: "keyword", foreground: "EC94A6" },
    { token: "delimiter", foreground: "706F7C" },
  ],
  colors: {
    "editor.background": "#0D0D0F",
    "editor.foreground": "#ECEBF3",
    "editorLineNumber.foreground": "#4A4A54",
    "editorLineNumber.activeForeground": "#A9A8B6",
    "editor.lineHighlightBackground": "#16161A",
    "editor.selectionBackground": "#B8A8FF33",
    "editorCursor.foreground": "#B8A8FF",
    "editorIndentGuide.background1": "#1F1F24",
    "editorError.foreground": "#EC94A6",
    "editorWarning.foreground": "#E2C27E",
    "scrollbarSlider.background": "#34343B80",
  },
});
monaco.editor.defineTheme("opscope-light", {
  base: "vs",
  inherit: true,
  rules: [
    { token: "string.key.json", foreground: "19181D" },
    { token: "string.value.json", foreground: "3B6A00" },
    { token: "number", foreground: "6550CF" },
    { token: "keyword", foreground: "B03F59" },
    { token: "delimiter", foreground: "87848F" },
  ],
  colors: {
    "editor.background": "#FBFAF7",
    "editorLineNumber.foreground": "#B9B5AA",
    "editor.lineHighlightBackground": "#F2F0EA",
    "editor.selectionBackground": "#6550CF22",
    "editorCursor.foreground": "#6550CF",
    "editorError.foreground": "#B03F59",
  },
});

/** Monaco JSON editor; issues become inline markers on the offending key. */
export function JsonEditor({ value, onChange, issues, theme, height = 560 }: { value: string; onChange: (v: string) => void; issues: InputIssue[]; theme: Theme; height?: number }) {
  const ed = useRef<Parameters<OnMount>[0] | null>(null);
  useEffect(() => {
    const model = ed.current?.getModel();
    if (!model) return;
    const text = model.getValue();
    const markers = issues.map((i) => {
      const key = i.path.split(".").pop() ?? "";
      const at = key && key !== "(root)" ? text.indexOf(`"${key}"`) : -1;
      const pos = model.getPositionAt(at >= 0 ? at : 0);
      const end = model.getPositionAt(at >= 0 ? at + key.length + 2 : Math.min(text.length, 1));
      return { severity: monaco.MarkerSeverity.Error, message: `${i.path}: ${i.message}`, startLineNumber: pos.lineNumber, startColumn: pos.column, endLineNumber: end.lineNumber, endColumn: end.column };
    });
    monaco.editor.setModelMarkers(model, "opscope", markers);
  }, [issues, value]);

  return (
    <Editor
      height={height}
      defaultLanguage="json"
      value={value}
      theme={theme === "dark" ? "opscope-dark" : "opscope-light"}
      onChange={(v) => onChange(v ?? "")}
      onMount={(editor) => {
        ed.current = editor;
      }}
      options={{
        fontFamily: "IBM Plex Mono, ui-monospace, monospace",
        fontSize: 12.5,
        lineHeight: 20,
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        renderLineHighlight: "line",
        padding: { top: 12, bottom: 12 },
        tabSize: 2,
        wordWrap: "on",
        ariaLabel: "UserOperation JSON",
        fixedOverflowWidgets: true,
      }}
    />
  );
}
