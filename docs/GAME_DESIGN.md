# Game Design

## Player fantasy

The player is a field programmer watching three tiny combat machines express their intent in motion. The fantasy is not typing arbitrary code; it is writing a compact doctrine, deploying it, seeing the squad succeed or fail, and recognizing exactly which rule caused the behavior.

## Core loop

1. Read or revise a robot's ordered rules.
2. Deploy the squad with a chosen seed.
3. Observe three robots interpret their scripts in a continuous arena.
4. Diagnose positioning, idle time, unsafe attacks, and retreat behavior.
5. Choose one deterministic squad upgrade after a cleared wave.
6. Survive three waves, inspect the run analysis, and revise.

The default scripts make the first screen immediately playable. Editing is optional before the first run; understanding comes from watching decision labels and combat outcomes.

## Player decisions

- Rule priority: an early broad condition can shadow a later specialized one.
- Thresholds: retreat timing trades damage uptime for survival.
- Resource use: energy checks can prevent empty attack attempts.
- Formation behavior: `guard()` protects a vulnerable ally at the cost of aggression.
- Upgrade selection: each run offers three seeded choices that amplify a squad-wide strength.
- Seed choice: repeat a scenario for controlled iteration or change it for a new encounter layout.

## Success and failure

Victory requires clearing all three waves with at least one robot alive. Defeat occurs when the squad is destroyed. A result is still useful when the run fails: damage, decision distribution, source-driven behavior metrics, and observations indicate what to change.

## Game-feel principles

- Logic must look alive: continuous steering and clear silhouettes turn rules into readable motion.
- Feedback must explain: source labels, health bars, hit flashes, trails, and restrained bursts clarify causality.
- Effects serve state: reward wave completion and important impacts without hiding targets.
- Iteration stays quick: compiling is automatic, reset retains scripts, and speed controls shorten repeated observation.
- The arena remains the visual focus even though code is a primary verb.

## Progression direction

Future progression should unlock new programming concepts alongside new combat possibilities. Variables, reusable functions, squad signals, sensors, and limited memory can become rewards as well as language features. Persistent unlocks should broaden strategy without replacing the deterministic core.

## Commercial expansion possibilities

- Robot chassis and weapon archetypes with distinct sensor/command surfaces
- Encounter modifiers that reward specific logic styles
- A visual trace debugger and timeline replay
- Daily seeded challenges with verified checksums
- Shareable script squads and replay files
- A structured campaign that teaches increasingly expressive automation

These are directions, not v0.1 features. Multiplayer, cloud services, monetization, and a full campaign remain deliberately outside this slice.
