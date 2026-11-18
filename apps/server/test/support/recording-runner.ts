import { ScriptedProcessRunner } from '@/modules/system/gateways/scripted.process-runner';

/** A scripted runner that also keeps every line written to a process, to check what a provider is told. */
export function recordingRunner(writes: string[]) {
  class RecordingRunner extends ScriptedProcessRunner {
    override open(request: Parameters<ScriptedProcessRunner['open']>[0]) {
      const process = super.open(request);
      const write = process.write.bind(process);
      process.write = (line) => {
        writes.push(line);
        write(line);
      };
      return process;
    }
  }
  return new RecordingRunner();
}
