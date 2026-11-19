import { Dialog } from '@/shared/components/Dialog';
import { useApp } from '@/shared/stores/app';

export function SkillsLoading() {
  const colors = useApp((state) => state.colors);
  return (
    <Dialog title="skills" width={52}>
      <text fg={colors.accentBright}>Reading your agent skills…</text>
      <text fg={colors.muted} marginTop={1}>
        favo is checking which skills to share before you open a provider.
      </text>
    </Dialog>
  );
}
