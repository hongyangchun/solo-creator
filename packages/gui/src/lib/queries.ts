import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { engine, MasterPostDetail, SecretItem, DispatchRecord } from './engineClient';

const KEYS = {
  secrets: ['secrets'] as const,
  masters: ['masters'] as const,
  master: (id: string) => ['master', id] as const,
  dashboard: ['dashboard'] as const,
  dispatches: (id: string) => ['dispatches', id] as const
};

// ---- ① 密钥 ----
export function useSecrets() {
  return useQuery<SecretItem[]>({ queryKey: KEYS.secrets, queryFn: engine.listSecrets });
}

export function useSetSecret() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ key, value }: { key: string; value: string }) => engine.setSecret(key, value),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEYS.secrets })
  });
}

export function useDeleteSecret() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (key: string) => engine.deleteSecret(key),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEYS.secrets })
  });
}

// ---- ② 母稿 ----
export function useMasters() {
  return useQuery({ queryKey: KEYS.masters, queryFn: () => engine.listMasters(1, 50) });
}

export function useMaster(id: string | null) {
  return useQuery<MasterPostDetail>({
    queryKey: KEYS.master(id || ''),
    queryFn: () => engine.getMaster(id!),
    enabled: Boolean(id)
  });
}

export function useCreateMaster() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ idea, topic }: { idea: string; topic?: string }) => engine.createMaster(idea, topic),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEYS.masters })
  });
}

export function useSaveMaster() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: { title?: string; masterMarkdown?: string } }) =>
      engine.updateMaster(id, patch),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: KEYS.masters });
      qc.invalidateQueries({ queryKey: KEYS.master(data.id) });
    }
  });
}

// ---- ③ 预览 ----
export function useTranspile() {
  return useMutation({
    mutationFn: ({ id, channels }: { id: string; channels: string[] }) => engine.transpile(id, channels)
  });
}

export function useCardPreview() {
  return useMutation({
    mutationFn: ({ id, theme }: { id: string; theme: 'minimal_dark' | 'notion_light' }) =>
      engine.cardPreview(id, theme)
  });
}

// ---- ④ 发布 ----
export function usePublish() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, channels }: { id: string; channels: string[] }) => engine.publish(id, channels),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEYS.dashboard })
  });
}

export function useDashboard() {
  return useQuery({ queryKey: KEYS.dashboard, queryFn: engine.dashboard });
}

export function useDispatches(id: string | null) {
  return useQuery<DispatchRecord[]>({
    queryKey: KEYS.dispatches(id || ''),
    queryFn: () => engine.dispatches(id!),
    enabled: Boolean(id)
  });
}

export function useRetryDispatch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => engine.retryDispatch(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEYS.dashboard })
  });
}
