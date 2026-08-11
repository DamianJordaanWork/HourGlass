import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Id } from '@domain/common/types';
import type { CalendarAccountInput } from '@composition/container';
import { useContainer } from '@presentation/container-context';

/** Configured calendar accounts, for the Settings panel. */
export function useCalendarAccounts() {
  const c = useContainer();
  return useQuery({ queryKey: ['calendarAccounts'], queryFn: () => c.connections.listCalendars() });
}

/** Save/delete/connect calendar accounts, then invalidate everything they influence. */
export function useCalendarActions() {
  const c = useContainer();
  const qc = useQueryClient();
  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['calendarAccounts'] });
    void qc.invalidateQueries({ queryKey: ['connectionStatus'] });
    void qc.invalidateQueries({ queryKey: ['meetings'] });
  };

  const saveCalendar = useMutation({
    mutationFn: (input: CalendarAccountInput) => c.connections.saveCalendarAccount(input),
    onSuccess: invalidate,
  });
  const deleteCalendar = useMutation({
    mutationFn: (id: Id) => c.connections.deleteCalendarAccount(id),
    onSuccess: invalidate,
  });
  const connectMicrosoft = useMutation({
    mutationFn: ({ clientId, existingId }: { clientId: string; existingId?: Id }) =>
      c.connections.connectMicrosoftAccount(clientId, existingId),
    onSuccess: invalidate,
  });
  const connectGoogle = useMutation({
    mutationFn: ({ clientId, existingId }: { clientId: string; existingId?: Id }) =>
      c.connections.connectGoogleAccount(clientId, existingId),
    onSuccess: invalidate,
  });
  const probeCalendar = useMutation({
    mutationFn: (id: Id) => c.connections.probeCalendarAccount(id),
    onSuccess: invalidate,
  });

  return { saveCalendar, deleteCalendar, connectMicrosoft, connectGoogle, probeCalendar };
}
