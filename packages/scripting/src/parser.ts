import type { CommandName, ScriptDiagnostic, SourceSpan } from '@swarm-script/shared';
import type {
  BooleanExpression,
  ComparisonExpression,
  ComparisonOperator,
  Expression,
  NotExpression,
  Program,
  Rule,
  ValueExpression,
} from './ast';
import { tokenize, type Token, type TokenType } from './tokenizer';

const commands = new Set<CommandName>([
  'attack',
  'approach',
  'retreat',
  'guard',
  'wait',
  'overcharge',
  'shield',
  'mark',
]);
const variables = new Set([
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
]);

class ParseFailure extends Error {
  constructor(
    message: string,
    readonly token: Token,
    readonly code: string,
  ) {
    super(message);
  }
}

export interface CompileResult {
  program: Program | null;
  diagnostics: ScriptDiagnostic[];
}

export function compileScript(source: string): CompileResult {
  const tokenized = tokenize(source);
  if (tokenized.diagnostics.length > 0)
    return { program: null, diagnostics: tokenized.diagnostics };
  try {
    const program = new Parser(tokenized.tokens).parseProgram();
    const diagnostics = validateProgram(program);
    return {
      program: diagnostics.some((item) => item.severity === 'error') ? null : program,
      diagnostics,
    };
  } catch (error) {
    if (error instanceof ParseFailure) {
      return {
        program: null,
        diagnostics: [
          { severity: 'error', code: error.code, message: error.message, span: error.token.span },
        ],
      };
    }
    throw error;
  }
}

class Parser {
  private current = 0;

  constructor(private readonly tokens: Token[]) {}

  parseProgram(): Program {
    const rules: Rule[] = [];
    while (!this.check('eof')) rules.push(this.parseRule());
    if (rules.length === 0)
      throw new ParseFailure('Add at least one when rule.', this.peek(), 'EMPTY_SCRIPT');
    const first = rules[0];
    const last = rules.at(-1);
    if (!first || !last) throw new Error('Program span invariant failed');
    return { kind: 'Program', rules, span: mergeSpans(first.span, last.span) };
  }

  private parseRule(): Rule {
    const start = this.peek();
    let condition: Expression | null;
    if (this.match('when')) condition = this.parseOr();
    else if (this.match('otherwise')) condition = null;
    else
      throw new ParseFailure(
        'Expected “when” or “otherwise” to start a rule.',
        this.peek(),
        'EXPECTED_RULE',
      );

    this.consume('leftBrace', 'Expected “{” after the rule condition.', 'EXPECTED_LEFT_BRACE');
    const commandToken = this.consume(
      'identifier',
      'Expected a command such as attack().',
      'EXPECTED_COMMAND',
    );
    this.consume(
      'leftParen',
      'Commands need parentheses, for example attack().',
      'EXPECTED_LEFT_PAREN',
    );
    this.consume(
      'rightParen',
      'Commands do not take arguments yet; close with “)”.',
      'EXPECTED_RIGHT_PAREN',
    );
    this.match('semicolon');
    const end = this.consume(
      'rightBrace',
      'Expected “}” after the command.',
      'EXPECTED_RIGHT_BRACE',
    );
    return {
      kind: 'Rule',
      condition,
      command: commandToken.lexeme as CommandName,
      commandSpan: commandToken.span,
      span: mergeSpans(start.span, end.span),
    };
  }

  private parseOr(): Expression {
    let expression = this.parseAnd();
    while (this.match('or')) {
      const right = this.parseAnd();
      expression = this.booleanExpression('or', expression, right);
    }
    return expression;
  }

  private parseAnd(): Expression {
    let expression = this.parseNot();
    while (this.match('and')) {
      const right = this.parseNot();
      expression = this.booleanExpression('and', expression, right);
    }
    return expression;
  }

  private parseNot(): Expression {
    if (this.match('not')) {
      const operator = this.previous();
      const operand = this.parseNot();
      const node: NotExpression = {
        kind: 'Not',
        operand,
        span: mergeSpans(operator.span, operand.span),
      };
      return node;
    }
    if (this.match('leftParen')) {
      const expression = this.parseOr();
      this.consume('rightParen', 'Expected “)” after the condition.', 'EXPECTED_RIGHT_PAREN');
      return expression;
    }
    return this.parseComparison();
  }

  private parseComparison(): ComparisonExpression {
    const left = this.parseValue();
    const operator = this.consume(
      'operator',
      'Expected a comparison like <, <=, ==, or !=.',
      'EXPECTED_COMPARISON',
    );
    const right = this.parseValue();
    return {
      kind: 'Comparison',
      left,
      operator: operator.lexeme as ComparisonOperator,
      right,
      span: mergeSpans(left.span, right.span),
    };
  }

  private parseValue(): ValueExpression {
    if (this.match('number')) {
      const token = this.previous();
      return { kind: 'Value', valueType: 'number', value: Number(token.lexeme), span: token.span };
    }
    const first = this.consume(
      'identifier',
      'Expected a readable value or number.',
      'EXPECTED_VALUE',
    );
    let name = first.lexeme;
    let end = first.span;
    if (this.match('dot')) {
      const second = this.consume(
        'identifier',
        'Expected a property after “.”.',
        'EXPECTED_PROPERTY',
      );
      name += `.${second.lexeme}`;
      end = second.span;
    }
    return { kind: 'Value', valueType: 'variable', value: name, span: mergeSpans(first.span, end) };
  }

  private booleanExpression(
    operator: 'and' | 'or',
    left: Expression,
    right: Expression,
  ): BooleanExpression {
    return { kind: 'Boolean', operator, left, right, span: mergeSpans(left.span, right.span) };
  }

  private match(type: TokenType): boolean {
    if (!this.check(type)) return false;
    this.current += 1;
    return true;
  }

  private consume(type: TokenType, message: string, code: string): Token {
    if (this.check(type)) return this.advance();
    throw new ParseFailure(message, this.peek(), code);
  }

  private check(type: TokenType): boolean {
    return this.peek().type === type;
  }

  private advance(): Token {
    if (!this.check('eof')) this.current += 1;
    return this.previous();
  }

  private peek(): Token {
    const token = this.tokens[this.current];
    if (!token) throw new Error('Token stream ended without EOF');
    return token;
  }

  private previous(): Token {
    const token = this.tokens[this.current - 1];
    if (!token) throw new Error('Parser has no previous token');
    return token;
  }
}

function validateProgram(program: Program): ScriptDiagnostic[] {
  const diagnostics: ScriptDiagnostic[] = [];
  let fallbackSeen = false;
  for (const rule of program.rules) {
    if (!commands.has(rule.command)) {
      diagnostics.push({
        severity: 'error',
        code: 'UNKNOWN_COMMAND',
        span: rule.commandSpan,
        message: `Unknown command “${rule.command}”. Try attack, approach, retreat, guard, or wait.`,
      });
    }
    if (fallbackSeen) {
      diagnostics.push({
        severity: 'warning',
        code: 'UNREACHABLE_RULE',
        span: rule.span,
        message: 'This rule cannot run because otherwise already matched.',
      });
    }
    if (rule.condition === null) fallbackSeen = true;
    else validateExpression(rule.condition, diagnostics);
  }
  if (!fallbackSeen) {
    diagnostics.push({
      severity: 'warning',
      code: 'MISSING_FALLBACK',
      span: program.span,
      message: 'Add an otherwise rule so the robot always has a command.',
    });
  }
  return diagnostics;
}

function validateExpression(expression: Expression, diagnostics: ScriptDiagnostic[]): void {
  if (expression.kind === 'Comparison') {
    for (const value of [expression.left, expression.right]) {
      if (value.valueType === 'variable' && !variables.has(String(value.value))) {
        diagnostics.push({
          severity: 'error',
          code: 'UNKNOWN_VALUE',
          span: value.span,
          message: `Unknown value “${String(value.value)}”. Check the command reference.`,
        });
      }
    }
  } else if (expression.kind === 'Not') validateExpression(expression.operand, diagnostics);
  else {
    validateExpression(expression.left, diagnostics);
    validateExpression(expression.right, diagnostics);
  }
}

function mergeSpans(left: SourceSpan, right: SourceSpan): SourceSpan {
  return { start: left.start, end: right.end };
}
