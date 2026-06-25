import type { ResourceOf, ResourceType } from '@trustos/ontology';

export interface ApiClientOptions {
  baseUrl?: string;
  /** Demo actor header used by the audit trail. */
  actor?: string;
}

export class ApiClientError extends Error {
  status: number;
  body: unknown;
  constructor(status: number, message: string, body: unknown) {
    super(message);
    this.name = 'ApiClientError';
    this.status = status;
    this.body = body;
  }
}

/** Thin typed HTTP client for the TrustOS API. */
export class TrustApiClient {
  readonly baseUrl: string;
  private actor: string;

  constructor(opts: ApiClientOptions = {}) {
    this.baseUrl = (opts.baseUrl ?? '/').replace(/\/$/, '');
    this.actor = opts.actor ?? 'demo-user';
  }

  async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        'content-type': 'application/json',
        'x-trustos-actor': this.actor,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    const parsed = text ? JSON.parse(text) : undefined;
    if (!res.ok) {
      const message =
        (parsed && (parsed.title || parsed.message)) || `Request failed (${res.status})`;
      throw new ApiClientError(res.status, message, parsed);
    }
    return parsed as T;
  }

  get<T>(path: string): Promise<T> {
    return this.request<T>('GET', path);
  }
  post<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>('POST', path, body);
  }
  put<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>('PUT', path, body);
  }
  delete<T>(path: string): Promise<T> {
    return this.request<T>('DELETE', path);
  }

  // --- Core FHIR resource helpers -------------------------------------------

  async listResources<T extends ResourceType>(
    type: T,
    params: Record<string, string | number | undefined> = {},
  ): Promise<ResourceOf<T>[]> {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== '') qs.set(k, String(v));
    }
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    const bundle = await this.get<{ entry: ResourceOf<T>[] }>(`/api/fhir/${type}${suffix}`);
    return bundle.entry;
  }

  getResource<T extends ResourceType>(type: T, id: string): Promise<ResourceOf<T>> {
    return this.get<ResourceOf<T>>(`/api/fhir/${type}/${id}`);
  }

  createResource<T extends ResourceType>(
    type: T,
    body: Partial<ResourceOf<T>>,
  ): Promise<ResourceOf<T>> {
    return this.post<ResourceOf<T>>(`/api/fhir/${type}`, body);
  }

  updateResource<T extends ResourceType>(
    type: T,
    id: string,
    body: Partial<ResourceOf<T>>,
  ): Promise<ResourceOf<T>> {
    return this.put<ResourceOf<T>>(`/api/fhir/${type}/${id}`, body);
  }
}
