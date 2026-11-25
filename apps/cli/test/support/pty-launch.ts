import { runTerminalPlan } from '@/run-terminal-plan';

// What the comb's renderer does when it steps aside for a provider.
process.stdin.pause();

const mode = process.argv[2];
const isCodex = mode === 'codex-limit';
const prints = mode === 'limit' || mode === 'startup-limit' || isCodex;
const notice = isCodex
  ? 'You’ve hit your usage limit. Upgrade to Pro or try again later.'
  : "You've hit your 5-hour limit · resets 12:20am (America/Sao_Paulo)";
const provider = prints
  ? `
  ${mode === 'startup-limit' ? '' : "console.log('provider-up');"}
  ${isCodex ? 'await Bun.sleep(50);' : ''}
  console.log(${JSON.stringify(notice)});
  setInterval(() => {}, 1000);
`
  : `
  console.log('provider-up');
  process.stdin.once('data', (typed) => {
    console.log('provider got ' + String(typed).trim());
    process.exit(0);
  });
`;

const result = await runTerminalPlan(
  { command: process.execPath, args: ['-e', provider], env: {}, unsetEnv: [] },
  process.env,
  {
    monitorLimits: isCodex ? 'codex' : 'claude',
    onReady:
      mode === 'limit'
        ? undefined
        : async () => {
            console.log('favo-handover');
          },
  }
);
console.log(`RESULT ${JSON.stringify(result)}`);
process.exit(0);
