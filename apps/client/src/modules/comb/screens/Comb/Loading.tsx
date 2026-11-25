import { Spinner } from '@/shared/components/Spinner';
import { useApp } from '@/shared/stores/app';

export function Loading({ label = 'loading providers' }: { label?: string }) {
  const colors = useApp((state) => state.colors);
  return (
    <box width="100%" height="100%" alignItems="center" justifyContent="center" backgroundColor={colors.background}>
      <Spinner label={label} />
    </box>
  );
}
