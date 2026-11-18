const args = process.argv.slice(2);
const exitFlag = args.find((word) => word.startsWith('--exit='));
const isWaitingForTerm = args.includes('--wait-for-term');

if (isWaitingForTerm) process.on('SIGTERM', () => process.exit(42));

console.log(JSON.stringify(args));

if (args.includes('--print-launcher')) {
  console.log(JSON.stringify({ launcher: process.env.FAVO_LAUNCHER, node: process.env.FAVO_LAUNCHER_NODE }));
}

if (isWaitingForTerm) {
  setInterval(() => {}, 1000);
} else if (args.includes('--die-by-sigkill')) {
  process.kill(process.pid, 'SIGKILL');
} else {
  process.exit(Number(exitFlag?.slice('--exit='.length) ?? 0));
}
