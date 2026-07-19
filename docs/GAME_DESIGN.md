# Game Design

## Player fantasy

The player is a field programmer watching three small combat machines express intent in motion. The fantasy is not arbitrary coding: it is writing a compact doctrine, deploying it, seeing the squad succeed or fail, and recognizing which rule caused the behavior.

## Core loop

1. Read or revise three ordered robot scripts.
2. Deploy a deterministic seed and observe rule highlights, positioning, energy, and cooldowns.
3. Diagnose threats: being surrounded, a Sniper telegraph, a Splitter about to multiply, or a guarded Bulwark facing the squad.
4. Choose one seeded, build-changing protocol after waves one and two.
5. Clear wave three, inspect ability use and the final build, then revise.

The defaults are deliberately functional. Editing is optional on the first run; understanding comes from watching active or blocked command lines and seeing the resulting combat state.

## The squad

| Role     | Identity                                 | Ability        | Cost / cooldown | Script purpose                                                                   |
| -------- | ---------------------------------------- | -------------- | --------------- | -------------------------------------------------------------------------------- |
| Striker  | Fast direct damage and short dash        | `overcharge()` | 45 energy / 8 s | Time a three-second offensive surge without abandoning low-health retreat logic. |
| Guardian | Durable anchor and ally protection       | `shield()`     | 40 energy / 9 s | Protect nearby allies for 3.6 seconds when pressure is concentrated.             |
| Scout    | Fast target selection and support damage | `mark()`       | 30 energy / 6 s | Mark a priority target for amplified squad damage for about 4.8 seconds.         |

Ability commands use the same safe parser and interpreter as movement and attacks. A command can fail because of energy, cooldown, target, or tactical preconditions; the editor highlights that outcome instead of silently pretending it ran.

## Enemy counters

- **Swarmer:** surrounds the weakest robot. Separation, movement, Shield, and area-oriented upgrades prevent a pile-up.
- **Sniper:** maintains range and shows a clear shot telegraph. Approach, retreat timing, Mark, and line-breaking movement matter.
- **Splitter:** creates two smaller children on death. Burst timing and chain/pierce upgrades prevent the arena from filling.
- **Bulwark:** reduces frontal damage. Flanking motion and target switching are more effective than shooting its guard.
- **Commander:** wave-three elite combining a strong telegraph with frontal defense. The final build and coordinated abilities should matter.

Enemy silhouettes, colors, facing, shields, marks, and telegraphs communicate these rules without requiring a separate manual.

## Build draft

Two between-wave choices create a compact build rather than a flat stat ladder. The pool currently contains 15 deterministic protocols:

- Arc relay, Volatile overcharge, Mirror aegis, Viral designator, Bounty circuit
- Cryo criticals, Trident bore, Proximity charge, Survival servos, Guardian dynamo
- Evasive clock, Lone target protocol, Overclocked rounds, Targeting lattice, Ceramic shells

Each card states both its direct effect and its build synergy. Examples include Mark feeding an energy economy, Shield combining with reflected damage, and rapid fire improving chain or slow application. The result screen records the final build beside real ability-use metrics.

## Game-feel principles

- **Logic must look alive:** faster steering, acceleration, deceleration, separation, knockback, and clear silhouettes turn rules into readable motion.
- **Feedback must explain:** source highlights, labels, health/energy state, trails, telegraphs, marks, shields, and impact flashes clarify causality.
- **Deaths use one vocabulary:** every hostile routes through the same echo-collapse, flash, ring, fragment, shake, hit-stop, and audio pipeline; intensity varies for child, standard, strong, and boss deaths.
- **Effects serve state:** event IDs prevent duplicated presentation, while reduced motion removes camera shake and shortens nonessential movement.
- **Iteration stays quick:** automatic compilation, retained scripts, reset, and reliable 1×/2×/4× controls support repeated observation.

## Balance target and evidence

The target is a tense 2–3 minute normal run where the defaults demonstrate all three abilities but are not guaranteed to win. A deterministic 20-seed harness (seeds 43090–43109) produced:

- 35% wins (7/20)
- 176.18 seconds average simulated run duration
- broad use of the upgrade pool rather than one forced choice
- average ability uses per run: Striker 1.35, Guardian 15.4, Scout 15.1
- mixed-pressure and Sniper-pressure failures, rather than a single universal failure mode

Seed `43105` is the curated default winning run. The automated harness is useful for regression and coarse tuning; human comprehension and strategy testing remain future work.

## Success and failure

Victory requires clearing all three waves with at least one robot alive. Defeat occurs when the squad is destroyed. Both outcomes report damage, damage received, kills, commands, per-role contribution, abilities, Shield mitigation, Mark bonus damage, final build, checksum, and observations such as the dominant incoming threat.

## Future direction

Variables, reusable predicates, squad signals, limited memory, replay scrubbing, and shareable seeded challenges can deepen programming without weakening the deterministic core. Multiplayer, cloud services, monetization, and a full campaign remain outside v0.2.
