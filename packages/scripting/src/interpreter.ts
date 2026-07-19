import type { CommandName, SourceSpan } from '@swarm-script/shared';
import type { Expression, Program, ValueExpression } from './ast';

export interface ScriptContext {
  health: number;
  health_percent: number;
  energy: number;
  'enemy.distance': number;
  attack_range: number;
  ally_lowest_health: number;
  ability_ready: number;
  ability_cooldown: number;
  'enemy.marked': number;
  allies_under_threat: number;
}

export interface DecisionResult {
  command: CommandName;
  span: SourceSpan;
  instructions: number;
  budgetExceeded: boolean;
}

export function executeProgram(
  program: Program,
  context: ScriptContext,
  instructionBudget = 64,
): DecisionResult {
  let instructions = 0;
  const spend = (): boolean => {
    instructions += 1;
    return instructions <= instructionBudget;
  };
  const evaluate = (expression: Expression): boolean => {
    if (!spend()) throw new BudgetExceeded();
    if (expression.kind === 'Not') return !evaluate(expression.operand);
    if (expression.kind === 'Boolean') {
      if (expression.operator === 'and')
        return evaluate(expression.left) && evaluate(expression.right);
      return evaluate(expression.left) || evaluate(expression.right);
    }
    const left = read(expression.left, context);
    const right = read(expression.right, context);
    switch (expression.operator) {
      case '<':
        return left < right;
      case '<=':
        return left <= right;
      case '>':
        return left > right;
      case '>=':
        return left >= right;
      case '==':
        return left === right;
      case '!=':
        return left !== right;
    }
  };

  try {
    for (const rule of program.rules) {
      if (!spend()) throw new BudgetExceeded();
      if (rule.condition === null || evaluate(rule.condition)) {
        return { command: rule.command, span: rule.span, instructions, budgetExceeded: false };
      }
    }
  } catch (error) {
    if (!(error instanceof BudgetExceeded)) throw error;
    return { command: 'wait', span: program.span, instructions, budgetExceeded: true };
  }
  return { command: 'wait', span: program.span, instructions, budgetExceeded: false };
}

function read(value: ValueExpression, context: ScriptContext): number {
  return value.valueType === 'number'
    ? Number(value.value)
    : context[value.value as keyof ScriptContext];
}

class BudgetExceeded extends Error {}
