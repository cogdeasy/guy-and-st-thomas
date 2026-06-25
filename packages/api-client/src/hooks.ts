import * as React from 'react';
import {
  useQuery,
  useMutation,
  useQueryClient,
  type UseQueryOptions,
} from '@tanstack/react-query';
import type { ResourceOf, ResourceType } from '@trustos/ontology';
import { TrustApiClient } from './client';

const ApiContext = React.createContext<TrustApiClient | null>(null);

export interface ApiProviderProps {
  client: TrustApiClient;
  children: React.ReactNode;
}

export function ApiProvider({ client, children }: ApiProviderProps) {
  return React.createElement(ApiContext.Provider, { value: client }, children);
}

export function useApiClient(): TrustApiClient {
  const client = React.useContext(ApiContext);
  if (!client) throw new Error('useApiClient must be used within <ApiProvider>');
  return client;
}

/** Generic GET hook for any module endpoint. */
export function useApiQuery<T>(
  path: string | null,
  options?: Omit<UseQueryOptions<T>, 'queryKey' | 'queryFn'>,
) {
  const client = useApiClient();
  return useQuery<T>({
    queryKey: ['api', path],
    queryFn: () => client.get<T>(path as string),
    enabled: path != null,
    ...options,
  });
}

/** Generic mutation hook (POST/PUT/DELETE) that invalidates queries on success. */
export function useApiMutation<TBody = unknown, TResult = unknown>(
  method: 'POST' | 'PUT' | 'DELETE',
  pathFn: (body: TBody) => string,
  invalidateKeys: string[] = ['api'],
) {
  const client = useApiClient();
  const qc = useQueryClient();
  return useMutation<TResult, Error, TBody>({
    mutationFn: (body: TBody) => client.request<TResult>(method, pathFn(body), body),
    onSuccess: () => {
      for (const key of invalidateKeys) qc.invalidateQueries({ queryKey: [key] });
    },
  });
}

export function useResourceList<T extends ResourceType>(
  type: T,
  params: Record<string, string | number | undefined> = {},
) {
  const client = useApiClient();
  return useQuery<ResourceOf<T>[]>({
    queryKey: ['resource', type, params],
    queryFn: () => client.listResources(type, params),
  });
}

export function useResource<T extends ResourceType>(type: T, id: string | null) {
  const client = useApiClient();
  return useQuery<ResourceOf<T>>({
    queryKey: ['resource', type, id],
    queryFn: () => client.getResource(type, id as string),
    enabled: id != null,
  });
}
