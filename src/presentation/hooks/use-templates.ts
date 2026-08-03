import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { MappingRule } from '@domain/templates/mapping';
import type { QuickTemplate } from '@domain/templates/quick-template';
import { useContainer } from '@presentation/container-context';

export function useMappingRules() {
  const c = useContainer();
  return useQuery({ queryKey: ['mappingRules'], queryFn: () => c.repos.mappingRules.list() });
}

export function useTemplatesData() {
  const c = useContainer();
  return useQuery({ queryKey: ['quickTemplates'], queryFn: () => c.repos.quickTemplates.list() });
}

/** Harvest project/task options for the pickers (live when connected, else demo). */
export function useHarvestOptions() {
  const c = useContainer();
  return useQuery({
    queryKey: ['harvestOptions', 'connectionStatus'],
    queryFn: () => c.harvestProjectOptions(),
  });
}

export function useTemplateActions() {
  const c = useContainer();
  const qc = useQueryClient();
  const invalidateRules = () => {
    void qc.invalidateQueries({ queryKey: ['mappingRules'] });
    void qc.invalidateQueries({ queryKey: ['wi-map'] });
  };
  const invalidateTemplates = () => qc.invalidateQueries({ queryKey: ['quickTemplates'] });

  const saveRule = useMutation({
    mutationFn: (rule: MappingRule) => c.repos.mappingRules.upsert(rule),
    onSuccess: invalidateRules,
  });
  const deleteRule = useMutation({
    mutationFn: (id: string) => c.repos.mappingRules.delete(id),
    onSuccess: invalidateRules,
  });
  const saveTemplate = useMutation({
    mutationFn: (template: QuickTemplate) => c.repos.quickTemplates.upsert(template),
    onSuccess: invalidateTemplates,
  });
  const deleteTemplate = useMutation({
    mutationFn: (id: string) => c.repos.quickTemplates.delete(id),
    onSuccess: invalidateTemplates,
  });

  return { saveRule, deleteRule, saveTemplate, deleteTemplate, newId: () => c.newId() };
}
