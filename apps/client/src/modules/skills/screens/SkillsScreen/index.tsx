import { isSkillWorkRunning, SkillDecision } from '@favo/domain/skills/skill';
import { useKeyboard } from '@opentui/react';
import { skillChoices } from '@/modules/skills/parsers/skillChoices';
import { Dialog } from '@/shared/components/Dialog';
import { KeyHint } from '@/shared/components/KeyHint';
import { useError } from '@/shared/error/useError';
import { useApp } from '@/shared/stores/app';

const DialogWidth = 72;

export function SkillsScreen() {
  const colors = useApp((state) => state.colors);
  const view = useApp((state) => state.skillsView);
  const choiceIndex = useApp((state) => state.skillChoiceIndex);
  const closeSkills = useApp((state) => state.closeSkills);
  const startSkillImport = useApp((state) => state.startSkillImport);
  const skipSkillSharing = useApp((state) => state.skipSkillSharing);
  const moveSkillChoice = useApp((state) => state.moveSkillChoice);
  const chooseSkillVersion = useApp((state) => state.chooseSkillVersion);
  const error = useError();
  const isRunning = isSkillWorkRunning(view.phase);
  const isChoosing = view.conflicts.length > 0;
  const isEnabled = view.decision === SkillDecision.enabled;
  const canStart = !isRunning && !isChoosing && !isEnabled;
  const canScanAgain = !isRunning && !isChoosing && isEnabled;
  const isFirstOffer = view.decision === SkillDecision.pending;
  const choices = skillChoices(view);

  useKeyboard((key) => {
    if (key.name === 'escape') closeSkills();
    else if (isRunning) return;
    else if (isChoosing && (key.name === 'down' || key.name === 'j')) moveSkillChoice(1);
    else if (isChoosing && (key.name === 'up' || key.name === 'k')) moveSkillChoice(-1);
    else if (key.name === 'return' && isChoosing) void error.handle(chooseSkillVersion)();
    else if (key.name === 'return' && canStart) void error.handle(startSkillImport)();
    else if (key.name === 'r' && canScanAgain) void error.handle(startSkillImport)();
    else if (key.name === 's' && isFirstOffer) void error.handle(skipSkillSharing)();
  });

  return (
    <Dialog title="skills" width={DialogWidth}>
      {canStart && (
        <>
          <text fg={colors.text}>Share your agent skills with every agent?</text>
          <text fg={colors.muted} marginTop={1}>
            favo copies the skills it finds in Claude, Codex, Copilot, Cursor, OpenCode and Antigravity into one catalog
            and links it back, so each agent sees them all. A replaced copy is backed up first. Skills that need a
            plugin or MCP tool say so: sharing does not install integrations.
          </text>
        </>
      )}
      {isRunning && <text fg={colors.accentBright}>{view.progress}</text>}
      {isChoosing && (
        <>
          <text fg={colors.text}>The same name has different content. Pick the version to keep.</text>
          {choices.map((choice, index) => (
            <box key={choice.candidate.id} flexDirection="column" marginTop={1}>
              <text fg={index === choiceIndex ? colors.accentBright : colors.text}>
                {index === choiceIndex ? '▸ ' : '  '}
                {choice.name} {choice.candidate.source}
              </text>
              <text fg={colors.faint} wrapMode="none" truncate>
                {'    '}
                {choice.candidate.preview.replaceAll('\n', ' ').slice(0, DialogWidth - 10)}
              </text>
            </box>
          ))}
        </>
      )}
      {canScanAgain && (
        <>
          <text fg={colors.text}>{view.progress || `${view.skills.length} skills in the Favo catalog`}</text>
          {view.skills.map((skill) => (
            <box key={skill.name} flexDirection="column">
              <text fg={colors.accent}>⬢ {skill.name}</text>
              {skill.warnings.map((warning) => (
                <text key={warning} fg={colors.faint} wrapMode="none" truncate>
                  {'    '}
                  {warning}
                </text>
              ))}
            </box>
          ))}
        </>
      )}
      {view.problems.map((problem) => (
        <text key={problem} fg={colors.danger} wrapMode="none" truncate>
          {problem}
        </text>
      ))}
      <box flexDirection="row" marginTop={1}>
        {canStart && <KeyHint keys="enter" label="share" onPress={error.handle(startSkillImport)} />}
        {isFirstOffer && !isRunning && <KeyHint keys="s" label="never" onPress={error.handle(skipSkillSharing)} />}
        {canScanAgain && <KeyHint keys="r" label="scan again" onPress={error.handle(startSkillImport)} />}
        {isChoosing && <KeyHint keys="↑↓" label="move" />}
        {isChoosing && <KeyHint keys="enter" label="keep this one" onPress={error.handle(chooseSkillVersion)} />}
        <KeyHint keys="esc" label={isFirstOffer ? 'later' : 'close'} onPress={closeSkills} />
      </box>
    </Dialog>
  );
}
