import { isSkillWorkRunning, SkillDecision } from '@favo/domain/skills/skill';
import type { ScrollBoxRenderable } from '@opentui/core';
import { useKeyboard, useTerminalDimensions } from '@opentui/react';
import { useEffect, useRef, useState } from 'react';
import { modifiedDay, shortPath, skillChoices } from '@/modules/skills/parsers/skillChoices';
import { Dialog } from '@/shared/components/Dialog';
import { KeyHint } from '@/shared/components/KeyHint';
import { useError } from '@/shared/error/useError';
import { useApp } from '@/shared/stores/app';

const DialogWidth = 84;
const DialogChrome = 14;
const MinimumListHeight = 5;

export function SkillsScreen() {
  const { height } = useTerminalDimensions();
  const colors = useApp((state) => state.colors);
  const view = useApp((state) => state.skillsView);
  const choiceIndex = useApp((state) => state.skillChoiceIndex);
  const closeSkills = useApp((state) => state.closeSkills);
  const startSkillImport = useApp((state) => state.startSkillImport);
  const skipSkillSharing = useApp((state) => state.skipSkillSharing);
  const moveSkillChoice = useApp((state) => state.moveSkillChoice);
  const chooseSkillVersion = useApp((state) => state.chooseSkillVersion);
  const keepNewestSkillVersions = useApp((state) => state.keepNewestSkillVersions);
  const autoResolveSkillVersions = useApp((state) => state.autoResolveSkillVersions);
  const isJudging = useApp((state) => state.isSkillsJudging);
  const [isConfirmingJudge, setIsConfirmingJudge] = useState(false);
  const scrollRef = useRef<ScrollBoxRenderable>(null);
  const error = useError();
  const isRunning = isSkillWorkRunning(view.phase) || isJudging;
  const isChoosing = view.conflicts.length > 0;
  const isEnabled = view.decision === SkillDecision.enabled;
  const canStart = !isRunning && !isChoosing && !isEnabled;
  const canScanAgain = !isRunning && !isChoosing && isEnabled;
  const isFirstOffer = view.decision === SkillDecision.pending;
  const choices = skillChoices(view);
  const listHeight = Math.max(height - DialogChrome, MinimumListHeight);
  const home = process.env.HOME;

  useKeyboard((key) => {
    if (isConfirmingJudge) {
      if (key.name === 'return') {
        setIsConfirmingJudge(false);
        void error.handle(autoResolveSkillVersions)();
      } else if (key.name === 'escape') setIsConfirmingJudge(false);
      return;
    }
    if (key.name === 'escape') closeSkills();
    else if (isRunning) return;
    else if (key.name === 'i' && isChoosing) setIsConfirmingJudge(true);
    else if (isChoosing && (key.name === 'down' || key.name === 'j')) moveSkillChoice(1);
    else if (isChoosing && (key.name === 'up' || key.name === 'k')) moveSkillChoice(-1);
    else if (key.name === 'return' && isChoosing) void error.handle(chooseSkillVersion)();
    else if (key.name === 'a' && isChoosing) void error.handle(keepNewestSkillVersions)();
    else if (key.name === 'return' && canStart) void error.handle(startSkillImport)();
    else if (key.name === 'r' && canScanAgain) void error.handle(startSkillImport)();
    else if (canScanAgain && (key.name === 'down' || key.name === 'j')) scrollRef.current?.scrollBy(1);
    else if (canScanAgain && (key.name === 'up' || key.name === 'k')) scrollRef.current?.scrollBy(-1);
    else if (key.name === 's' && isFirstOffer) void error.handle(skipSkillSharing)();
  });

  useEffect(() => {
    const chosen = choices[choiceIndex];
    if (chosen) scrollRef.current?.scrollChildIntoView(`skill:${chosen.candidate.id}`);
  }, [choiceIndex]);

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
      {isRunning && (
        <text fg={colors.accentBright}>
          {isJudging ? 'Your signed-in AI is comparing the versions…' : view.progress}
        </text>
      )}
      {isConfirmingJudge && (
        <text fg={colors.text} marginTop={1}>
          The differing versions will be sent to your signed-in AI (Claude first, then Codex and others), which only
          answers which one to keep. Press enter to go ahead, esc to cancel.
        </text>
      )}
      {isChoosing && (
        <>
          <text fg={colors.text}>
            {view.conflicts.length} skills have versions with different content. Pick the one to keep.
          </text>
          <scrollbox
            ref={scrollRef}
            height={Math.min(choices.length + view.conflicts.length, listHeight)}
            marginTop={1}
          >
            {view.conflicts.map((conflict) => (
              <box key={conflict.name} flexDirection="column" flexShrink={0}>
                <text fg={colors.accent}>{conflict.name}</text>
                {conflict.candidates.map((candidate) => {
                  const isChosen = choices[choiceIndex]?.candidate.id === candidate.id;
                  return (
                    <text
                      key={candidate.id}
                      id={`skill:${candidate.id}`}
                      fg={isChosen ? colors.accentBright : colors.muted}
                      wrapMode="none"
                      truncate
                    >
                      {isChosen ? ' ▸ ' : '   '}
                      {modifiedDay(candidate)} {shortPath(candidate.source, home)}
                    </text>
                  );
                })}
              </box>
            ))}
          </scrollbox>
        </>
      )}
      {canScanAgain && (
        <>
          <text fg={colors.text}>{view.progress || `${view.skills.length} skills in the Favo catalog`}</text>
          <scrollbox ref={scrollRef} height={Math.min(view.skills.length * 2, listHeight)}>
            {view.skills.map((skill) => (
              <box key={skill.name} flexDirection="column" flexShrink={0}>
                <text fg={colors.accent}>⬢ {skill.name}</text>
                {skill.warnings.slice(0, 1).map((warning) => (
                  <text key={warning} fg={colors.faint} wrapMode="none" truncate>
                    {'    '}
                    {warning}
                  </text>
                ))}
              </box>
            ))}
          </scrollbox>
        </>
      )}
      {view.problems.slice(0, 3).map((problem) => (
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
        {isChoosing && <KeyHint keys="i" label="let AI settle" onPress={() => setIsConfirmingJudge(true)} />}
        {isChoosing && <KeyHint keys="a" label="newest of each" onPress={error.handle(keepNewestSkillVersions)} />}
        <KeyHint keys="esc" label={isFirstOffer ? 'later' : 'close'} onPress={closeSkills} />
      </box>
    </Dialog>
  );
}
