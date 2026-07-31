# Accessibility Audit Checklist

Swarm Script combines a code editor, deployment controls, a live arena, and simulation status. Accessibility review must cover the complete play loop rather than isolated buttons.

## Keyboard flow

- [ ] A keyboard user can reach navigation, editor, deployment controls, simulation controls, results, and settings.
- [ ] Focus order follows the visual and task order.
- [ ] Focus is visible against every panel background.
- [ ] Opening and closing dialogs returns focus predictably.
- [ ] No custom control creates a keyboard trap.
- [ ] Common editor shortcuts do not unexpectedly trigger game controls.
- [ ] Start, pause, reset, speed, and deployment actions have documented keyboard behavior.

## Editor

- [ ] The Monaco editor has a clear accessible label and instructions.
- [ ] Compile and parse errors are associated with useful locations.
- [ ] Error summaries are available outside color-only decorations.
- [ ] Users can move between the editor, error list, and arena without pointer input.
- [ ] Shortcut help explains conflicts with browser and assistive-technology commands.
- [ ] Reduced editor functionality on touch devices is disclosed rather than hidden.

## Arena and simulation

The visual arena should have an equivalent concise status surface containing:

- current wave and simulation state;
- active, damaged, disabled, and destroyed robot counts;
- selected robot state and current command;
- objective or terminal outcome;
- compile, runtime, and budget errors.

- [ ] Important changes are announced without narrating every simulation frame.
- [ ] Announcements are throttled and prioritized.
- [ ] Color is not the only indication of team, health, target, error, or selection.
- [ ] Pause is immediately available.
- [ ] Motion and flashing remain within safe limits.
- [ ] Reduced-motion preferences suppress nonessential animation and camera effects.

## Controls and forms

- [ ] Buttons expose names that describe the action and current state.
- [ ] Toggle and speed controls expose selected values.
- [ ] Deployment coordinates and orientation can be understood without drag-only interaction.
- [ ] Disabled controls explain prerequisites where practical.
- [ ] Validation messages are programmatically associated with their fields.

## Results

- [ ] Terminal outcome receives focus or an appropriate announcement.
- [ ] Damage, survival, execution, and wave metrics have text labels.
- [ ] Tables use headers and sensible reading order.
- [ ] Replay or share actions identify what data will be exported.
- [ ] Restarting a run restores focus to a predictable control.

## Visual review

- [ ] Text and essential UI meet contrast requirements.
- [ ] Focus indicators meet contrast requirements.
- [ ] Zoom and larger text do not hide editor controls or results.
- [ ] Narrow layouts preserve access to the full loop.
- [ ] Tooltips are not the only source of instructions.

## Testing approach

Use a combination of:

- automated accessibility checks for semantic and contrast regressions;
- keyboard-only completion of the full loop;
- browser accessibility-tree inspection;
- screen-reader review of editor entry, compilation, simulation status, and results;
- reduced-motion and high-zoom testing;
- manual documentation of limitations that cannot be automated reliably.

A passing automated scan is not sufficient. Record browser, operating system, assistive technology, route, scenario, and unresolved limitations with the audit.

Related roadmap: #10.
