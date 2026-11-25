import { findProvider } from '@favo/domain/providers/provider';
import { runTerminalPlan } from '@/run-terminal-plan';

const provider = findProvider(process.argv[2] ?? '')!.id;
const folder = process.argv[3]!;
process.stdin.pause();
process.stdout.on('resize', () => void Bun.write(`${folder}/parent-resized`, 'yes'));
const script = `
  const initial = process.stdout.columns;
  setTimeout(() => process.exit(99), 3000);
  await Bun.write(${JSON.stringify(`${folder}/started`)}, String(initial));
  while (!(await Bun.file(${JSON.stringify(`${folder}/release`)}).exists())) await Bun.sleep(10);
  console.log('provider-size ' + process.stdout.columns + 'x' + process.stdout.rows);
  process.stdin.once('data', () => process.exit(0));
`;
const result = await runTerminalPlan(
  { command: process.execPath, args: ['-e', script], env: {}, unsetEnv: [] },
  process.env,
  { monitorLimits: provider, onReady: async () => {} }
);
console.log(`RESULT ${JSON.stringify(result)}`);
process.exit(0);
