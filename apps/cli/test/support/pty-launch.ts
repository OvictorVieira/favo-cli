import { runTerminalPlan } from '@/run-terminal-plan';

// What the comb's renderer does when it steps aside for a provider.
process.stdin.pause();

const prints = process.argv[2] === 'limit';
const provider = prints
  ? `
  console.log('provider-up');
  console.log('You have hit your usage limit.');
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
  { monitorLimits: 'claude' }
);
console.log(`RESULT ${JSON.stringify(result)}`);
process.exit(0);
