import type { DecisionTrace, ScriptDiagnostic } from '@swarm-script/shared';
import type * as Monaco from 'monaco-editor/esm/vs/editor/editor.api.js';
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import { useEffect, useRef, useState } from 'react';

type MonacoApi = typeof Monaco;

(
  globalThis as typeof globalThis & { MonacoEnvironment: { getWorker: () => Worker } }
).MonacoEnvironment = { getWorker: () => new EditorWorker() };

let languageRegistered = false;

function registerLanguage(monaco: MonacoApi): void {
  if (languageRegistered) return;
  languageRegistered = true;
  monaco.languages.register({ id: 'swarm-script' });
  monaco.languages.setMonarchTokensProvider('swarm-script', {
    keywords: ['when', 'otherwise', 'and', 'or', 'not'],
    tokenizer: {
      root: [
        [/[a-zA-Z_][\w]*/, { cases: { '@keywords': 'keyword', '@default': 'identifier' } }],
        [/\d+(\.\d+)?/, 'number'],
        [/[{}().;]/, 'delimiter'],
        [/[<>!=]=?/, 'operator'],
        [/\s+/, 'white'],
      ],
    },
  });
  monaco.languages.registerCompletionItemProvider('swarm-script', {
    provideCompletionItems(model, position) {
      const range = model.getWordUntilPosition(position);
      const replace = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: range.startColumn,
        endColumn: range.endColumn,
      };
      const values = [
        'health',
        'health_percent',
        'energy',
        'enemy.distance',
        'attack_range',
        'ally_lowest_health',
        'ability_ready',
        'ability_cooldown',
        'enemy.marked',
        'allies_under_threat',
      ];
      const commands = [
        'attack()',
        'approach()',
        'retreat()',
        'guard()',
        'wait()',
        'overcharge()',
        'shield()',
        'mark()',
      ];
      return {
        suggestions: [
          ...values.map((label) => ({
            label,
            kind: monaco.languages.CompletionItemKind.Variable,
            insertText: label,
            range: replace,
          })),
          ...commands.map((label) => ({
            label,
            kind: monaco.languages.CompletionItemKind.Function,
            insertText: label,
            range: replace,
          })),
          {
            label: 'when rule',
            kind: monaco.languages.CompletionItemKind.Snippet,
            insertText: 'when ${1:health} ${2:<} ${3:35} {\n  ${4:retreat}();\n}',
            insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
            range: replace,
          },
          {
            label: 'otherwise rule',
            kind: monaco.languages.CompletionItemKind.Snippet,
            insertText: 'otherwise {\n  ${1:approach}();\n}',
            insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
            range: replace,
          },
        ],
      };
    },
  });
  monaco.editor.defineTheme('swarm-night', {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: 'keyword', foreground: '61E8D5', fontStyle: 'bold' },
      { token: 'identifier', foreground: 'D7E7EA' },
      { token: 'number', foreground: 'F7C95C' },
      { token: 'operator', foreground: 'FF8B74' },
      { token: 'delimiter', foreground: '6B8C92' },
    ],
    colors: {
      'editor.background': '#091418',
      'editor.foreground': '#D7E7EA',
      'editorLineNumber.foreground': '#426168',
      'editorLineNumber.activeForeground': '#A8D7D8',
      'editor.selectionBackground': '#1B5A5F88',
      'editor.lineHighlightBackground': '#102228',
      'editorCursor.foreground': '#61E8D5',
    },
  });
}

export function CodeEditor({
  value,
  onChange,
  diagnostics,
  modelKey,
  activeTrace,
}: {
  value: string;
  onChange: (value: string) => void;
  diagnostics: ScriptDiagnostic[];
  modelKey: string;
  activeTrace: DecisionTrace | undefined;
}): React.JSX.Element {
  const host = useRef<HTMLDivElement>(null);
  const editor = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null);
  const model = useRef<Monaco.editor.ITextModel | null>(null);
  const monacoApi = useRef<MonacoApi | null>(null);
  const traceDecorations = useRef<Monaco.editor.IEditorDecorationsCollection | null>(null);
  const onChangeRef = useRef(onChange);
  const diagnosticsRef = useRef(diagnostics);
  const [editorStatus, setEditorStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  onChangeRef.current = onChange;
  diagnosticsRef.current = diagnostics;

  useEffect(() => {
    let disposed = false;
    let subscription: Monaco.IDisposable | null = null;
    setEditorStatus('loading');
    void import('monaco-editor/esm/vs/editor/editor.api.js')
      .then((monaco) => {
        if (disposed || !host.current) return;
        monacoApi.current = monaco;
        registerLanguage(monaco);
        const uri = monaco.Uri.parse(`inmemory://swarm/${modelKey}.swarm`);
        model.current =
          monaco.editor.getModel(uri) ?? monaco.editor.createModel(value, 'swarm-script', uri);
        editor.current = monaco.editor.create(host.current, {
          model: model.current,
          theme: 'swarm-night',
          automaticLayout: true,
          minimap: { enabled: false },
          fontFamily: 'Cascadia Code, JetBrains Mono, monospace',
          fontSize: 13,
          lineHeight: 20,
          lineNumbersMinChars: 3,
          folding: false,
          glyphMargin: false,
          scrollBeyondLastLine: false,
          overviewRulerBorder: false,
          overviewRulerLanes: 0,
          padding: { top: 10, bottom: 10 },
          wordWrap: 'on',
          tabSize: 2,
          ariaLabel: `${modelKey} robot script editor`,
        });
        applyDiagnostics(monaco, model.current, diagnosticsRef.current);
        traceDecorations.current = editor.current.createDecorationsCollection(
          activeTrace ? traceDecoration(monaco, activeTrace) : [],
        );
        subscription = editor.current.onDidChangeModelContent(() =>
          onChangeRef.current(editor.current?.getValue() ?? ''),
        );
        setEditorStatus('ready');
      })
      .catch(() => {
        if (!disposed) setEditorStatus('error');
      });
    return () => {
      disposed = true;
      subscription?.dispose();
      editor.current?.dispose();
      model.current?.dispose();
      editor.current = null;
      model.current = null;
      monacoApi.current = null;
      traceDecorations.current = null;
    };
  }, [modelKey]);

  useEffect(() => {
    if (model.current && model.current.getValue() !== value) model.current.setValue(value);
  }, [value]);

  useEffect(() => {
    if (monacoApi.current && model.current)
      applyDiagnostics(monacoApi.current, model.current, diagnostics);
  }, [diagnostics]);

  useEffect(() => {
    if (monacoApi.current && traceDecorations.current)
      traceDecorations.current.set(
        activeTrace ? traceDecoration(monacoApi.current, activeTrace) : [],
      );
  }, [activeTrace]);

  return (
    <div className="editor-host">
      <div className="editor-mount" ref={host} />
      {editorStatus !== 'ready' && (
        <div className={`chunk-loading ${editorStatus === 'error' ? 'error' : ''}`} role="status">
          <i />
          <span>
            {editorStatus === 'error' ? 'Editor failed to load.' : 'Loading behavior editor…'}
          </span>
        </div>
      )}
    </div>
  );
}

function traceDecoration(
  monaco: MonacoApi,
  trace: DecisionTrace,
): Monaco.editor.IModelDeltaDecoration[] {
  return [
    {
      range: new monaco.Range(trace.span.start.line, 1, trace.span.start.line, 1),
      options: {
        isWholeLine: true,
        className: trace.executed ? 'active-rule-line' : 'blocked-rule-line',
        overviewRuler: {
          color: trace.executed ? '#61e8d5' : '#ff786c',
          position: monaco.editor.OverviewRulerLane.Left,
        },
      },
    },
  ];
}

function applyDiagnostics(
  monaco: MonacoApi,
  model: Monaco.editor.ITextModel,
  diagnostics: ScriptDiagnostic[],
): void {
  monaco.editor.setModelMarkers(
    model,
    'swarm-compiler',
    diagnostics.map((diagnostic) => ({
      severity:
        diagnostic.severity === 'error'
          ? monaco.MarkerSeverity.Error
          : monaco.MarkerSeverity.Warning,
      message: diagnostic.message,
      startLineNumber: diagnostic.span.start.line,
      startColumn: diagnostic.span.start.column,
      endLineNumber: diagnostic.span.end.line,
      endColumn: Math.max(diagnostic.span.start.column + 1, diagnostic.span.end.column),
      code: diagnostic.code,
    })),
  );
}
