import { describe, expect, it } from 'vitest';
import { compileScript, executeProgram, tokenize } from './index';

const context = {
  health: 25,
  health_percent: 25,
  energy: 20,
  'enemy.distance': 80,
  attack_range: 100,
  ally_lowest_health: 70,
  ability_ready: 1,
  ability_cooldown: 0,
  'enemy.marked': 0,
  allies_under_threat: 0,
};

describe('tokenizer and parser', () => {
  it('tokenizes dotted values and preserves line/column spans', () => {
    const result = tokenize('when enemy.distance <= 100 { attack(); }');
    expect(result.diagnostics).toEqual([]);
    expect(result.tokens.find((token) => token.lexeme === 'enemy')?.span.start).toMatchObject({
      line: 1,
      column: 6,
    });
    expect(result.tokens.find((token) => token.lexeme === '<=')?.type).toBe('operator');
  });

  it('parses boolean precedence with and tighter than or', () => {
    const result = compileScript(
      'when health < 10 or energy > 5 and enemy.distance < 20 { attack(); }',
    );
    expect(result.program?.rules[0]?.condition).toMatchObject({
      kind: 'Boolean',
      operator: 'or',
      right: { kind: 'Boolean', operator: 'and' },
    });
  });

  it('reports friendly unknown syntax and values', () => {
    expect(compileScript('whenever health < 5 { attack(); }').diagnostics[0]?.code).toBe(
      'EXPECTED_RULE',
    );
    expect(compileScript('when mana > 5 { attack(); }').diagnostics[0]).toMatchObject({
      code: 'UNKNOWN_VALUE',
      severity: 'error',
    });
    expect(compileScript('when health > 5 { explode(); }').diagnostics[0]?.message).toContain(
      'Unknown command',
    );
  });
});

describe('interpreter', () => {
  it('uses the first matching rule and returns its source span', () => {
    const compiled = compileScript(
      'when health < 35 { retreat(); }\nwhen energy > 1 { attack(); }\notherwise { wait(); }',
    );
    expect(compiled.program).not.toBeNull();
    const decision = executeProgram(compiled.program!, context);
    expect(decision.command).toBe('retreat');
    expect(decision.span.start.line).toBe(1);
  });

  it('enforces the instruction budget', () => {
    const compiled = compileScript('when health < 1 { retreat(); } otherwise { approach(); }');
    const decision = executeProgram(compiled.program!, context, 1);
    expect(decision).toMatchObject({ command: 'wait', budgetExceeded: true });
  });

  it('supports not, and, or, and every comparison operator', () => {
    for (const operator of ['<', '<=', '>', '>=', '==', '!=']) {
      const compiled = compileScript(
        `when not (health ${operator} 25) or energy >= 20 and health == 25 { guard(); }`,
      );
      expect(executeProgram(compiled.program!, context).command).toBe('guard');
    }
  });

  it('supports role abilities and tactical sensors without dynamic execution', () => {
    const compiled = compileScript(
      'when ability_ready == 1 and enemy.marked == 0 { mark(); } otherwise { shield(); }',
    );
    expect(executeProgram(compiled.program!, context).command).toBe('mark');
    expect(
      executeProgram(compiled.program!, {
        ...context,
        ability_ready: 0,
        'enemy.marked': 1,
      }).command,
    ).toBe('shield');
    expect(compileScript('otherwise { overcharge(); }').program).not.toBeNull();
  });
});
