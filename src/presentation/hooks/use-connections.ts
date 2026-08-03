import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AdoConnectionInput } from '@composition/container';
import { useContainer } from '@presentation/container-context';

/** Live view of what's configured, for the Settings panel + demo badge. */
export function useConnectionStatus() {
  const c = useContainer();
  return useQuery({
    queryKey: ['connectionStatus'],
    queryFn: async () => ({
      configured: c.isConfigured(),
      harvest: await c.connections.getHarvestConfig(),
      ado: await c.connections.listAdo(),
    }),
  });
}

/** Save/clear connection creds, then invalidate everything they influence. */
export function useConnectionActions() {
  const c = useContainer();
  const qc = useQueryClient();
  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['connectionStatus'] });
    void qc.invalidateQueries({ queryKey: ['workItems'] });
    void qc.invalidateQueries({ queryKey: ['meetings'] });
    void qc.invalidateQueries({ queryKey: ['wi-map'] });
    void qc.invalidateQueries({ queryKey: ['settings'] });
  };

  const saveHarvest = useMutation({
    mutationFn: ({ accountId, token }: { accountId: string; token?: string }) =>
      c.connections.saveHarvest(accountId, token),
    onSuccess: invalidate,
  });
  const clearHarvest = useMutation({
    mutationFn: () => c.connections.clearHarvest(),
    onSuccess: invalidate,
  });
  const saveAdo = useMutation({
    mutationFn: ({ input, pat }: { input: AdoConnectionInput; pat?: string }) =>
      c.connections.saveAdo(input, pat),
    onSuccess: invalidate,
  });
  const deleteAdo = useMutation({
    mutationFn: (id: string) => c.connections.deleteAdo(id),
    onSuccess: invalidate,
  });

  return { saveHarvest, clearHarvest, saveAdo, deleteAdo };
}
