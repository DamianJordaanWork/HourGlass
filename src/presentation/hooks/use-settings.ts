import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Settings } from '@domain/settings/settings';
import { useContainer } from '@presentation/container-context';

export function useSettings() {
  const c = useContainer();
  return useQuery({ queryKey: ['settings'], queryFn: () => c.repos.settings.get() });
}

export function useSaveSettings() {
  const c = useContainer();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (settings: Settings) => c.repos.settings.save(settings),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['settings'] });
      void qc.invalidateQueries({ queryKey: ['insights'] });
    },
  });
}
