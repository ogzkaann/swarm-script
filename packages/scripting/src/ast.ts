import type { CommandName, SourceSpan } from '@swarm-script/shared';

export type ComparisonOperator = '<' | '<=' | '>' | '>=' | '==' | '!=';

export interface Program {
  kind: 'Program';
  rules: Rule[];
  span: SourceSpan;
}

export interface Rule {
  kind: 'Rule';
  condition: Expression | null;
  command: CommandName;
  span: SourceSpan;
  commandSpan: SourceSpan;
}

export type Expression = ComparisonExpression | BooleanExpression | NotExpression;

export interface ComparisonExpression {
  kind: 'Comparison';
  left: ValueExpression;
  operator: ComparisonOperator;
  right: ValueExpression;
  span: SourceSpan;
}

export interface BooleanExpression {
  kind: 'Boolean';
  operator: 'and' | 'or';
  left: Expression;
  right: Expression;
  span: SourceSpan;
}

export interface NotExpression {
  kind: 'Not';
  operand: Expression;
  span: SourceSpan;
}

export interface ValueExpression {
  kind: 'Value';
  value: number | string;
  valueType: 'number' | 'variable';
  span: SourceSpan;
}
