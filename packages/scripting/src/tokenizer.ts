import type { ScriptDiagnostic, SourcePosition, SourceSpan } from '@swarm-script/shared';

export type TokenType =
  | 'when'
  | 'otherwise'
  | 'and'
  | 'or'
  | 'not'
  | 'identifier'
  | 'number'
  | 'operator'
  | 'leftBrace'
  | 'rightBrace'
  | 'leftParen'
  | 'rightParen'
  | 'dot'
  | 'semicolon'
  | 'eof';

export interface Token {
  type: TokenType;
  lexeme: string;
  span: SourceSpan;
}

const keywordTypes: Record<string, TokenType | undefined> = {
  when: 'when',
  otherwise: 'otherwise',
  and: 'and',
  or: 'or',
  not: 'not',
};

export interface TokenizeResult {
  tokens: Token[];
  diagnostics: ScriptDiagnostic[];
}

export function tokenize(source: string): TokenizeResult {
  const tokens: Token[] = [];
  const diagnostics: ScriptDiagnostic[] = [];
  let offset = 0;
  let line = 1;
  let column = 1;

  const position = (): SourcePosition => ({ offset, line, column });
  const advance = (): string => {
    const char = source[offset] ?? '';
    offset += 1;
    if (char === '\n') {
      line += 1;
      column = 1;
    } else {
      column += 1;
    }
    return char;
  };
  const add = (type: TokenType, start: SourcePosition, lexeme: string): void => {
    tokens.push({ type, lexeme, span: { start, end: position() } });
  };

  while (offset < source.length) {
    const char = source[offset] ?? '';
    if (/\s/.test(char)) {
      advance();
      continue;
    }
    const start = position();
    if (/[A-Za-z_]/.test(char)) {
      let value = '';
      while (/[A-Za-z0-9_]/.test(source[offset] ?? '')) value += advance();
      add(keywordTypes[value] ?? 'identifier', start, value);
      continue;
    }
    if (/\d/.test(char)) {
      let value = '';
      while (/\d/.test(source[offset] ?? '')) value += advance();
      if (source[offset] === '.' && /\d/.test(source[offset + 1] ?? '')) {
        value += advance();
        while (/\d/.test(source[offset] ?? '')) value += advance();
      }
      add('number', start, value);
      continue;
    }
    const pair = source.slice(offset, offset + 2);
    if (['<=', '>=', '==', '!='].includes(pair)) {
      advance();
      advance();
      add('operator', start, pair);
      continue;
    }
    if (char === '<' || char === '>') {
      add('operator', start, advance());
      continue;
    }
    const punctuation: Record<string, TokenType | undefined> = {
      '{': 'leftBrace',
      '}': 'rightBrace',
      '(': 'leftParen',
      ')': 'rightParen',
      '.': 'dot',
      ';': 'semicolon',
    };
    const type = punctuation[char];
    if (type) {
      add(type, start, advance());
      continue;
    }
    advance();
    diagnostics.push({
      severity: 'error',
      code: 'UNEXPECTED_CHARACTER',
      message: `I don't recognize “${char}”. Try a comparison, boolean operator, or command.`,
      span: { start, end: position() },
    });
  }
  const end = position();
  tokens.push({ type: 'eof', lexeme: '', span: { start: end, end } });
  return { tokens, diagnostics };
}
