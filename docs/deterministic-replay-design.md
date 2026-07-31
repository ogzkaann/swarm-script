# Deterministic Run Replay Design

Swarm Script should reproduce a completed run from compact deterministic inputs rather than storing every rendered frame.

## Replay payload

A replay record should include:

- replay format version;
- application and ruleset version;
- simulation seed;
- arena or scenario identifier;
- normalized squad programs;
- deployment positions and orientations;
- player-issued commands that affect simulation state;
- simulation configuration such as fixed step and limits;
- expected terminal outcome and selected summary metrics.

Do not include UI-only state unless it changes simulation behavior.

## Determinism contract

A replay is valid only when the same supported ruleset produces the same authoritative state sequence and terminal result.

The contract must define:

- seeded random-number generator implementation;
- fixed-step duration;
- entity iteration order;
- collision and target-selection tie breakers;
- numeric precision and rounding rules;
- command ordering within a simulation step;
- interpreter budgets and failure behavior;
- serialization order for hashed verification state.

Rendering frame rate, animation interpolation, and UI timing must not influence the simulation.

## Version compatibility

Replay data must expose both `formatVersion` and `rulesetVersion`.

On load:

- reject unknown format versions explicitly;
- reject unsupported ruleset versions rather than silently using current behavior;
- allow a migration only when the transformation is deterministic and tested;
- display the incompatibility reason to the user.

## Verification

Record a compact verification block:

- terminal outcome;
- final simulation tick;
- surviving entity IDs;
- selected aggregate metrics;
- hash of canonical terminal state.

During replay, compare the generated result with the recorded block. A mismatch should stop verification and report the first known divergence point when available.

## Storage and sharing

Start local-first:

- serialize to versioned JSON;
- omit accounts, analytics, and backend dependencies;
- validate size before import;
- treat imported program text and labels as untrusted content;
- never execute arbitrary JavaScript or bypass the existing parser and interpreter.

## Test plan

- identical seed and inputs produce identical terminal hash;
- different seed changes a scenario with randomness;
- renderer speed and browser frame rate do not change results;
- command ordering remains stable;
- malformed and oversized replay files fail safely;
- unknown versions fail visibly;
- interpreter budget errors replay consistently;
- replay after serialization round-trip remains identical.

## Implementation sequence

1. Define replay and verification TypeScript schemas.
2. Canonicalize simulation inputs and terminal state.
3. Add export from a completed run.
4. Add import validation and compatibility checks.
5. Run the existing worker simulation from replay inputs.
6. Compare verification state and expose mismatch details.
7. Add fixture-based deterministic tests.

Related roadmap: #8.
