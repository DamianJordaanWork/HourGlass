import { describe, expect, it } from 'vitest';
import { HttpTransportError, TauriHttpTransport } from '@infrastructure/http/tauri-http-transport';
import type { TauriFetch } from '@infrastructure/http/tauri-http-driver';

interface Call {
  readonly url: string;
  readonly method: string;
  readonly headers?: Record<string, string>;
  readonly body?: string;
}

function fakeFetch(
  handler: (call: Call) => { status: number; body: string; headers?: Record<string, string> },
): { fetchImpl: TauriFetch; calls: Call[] } {
  const calls: Call[] = [];
  const fetchImpl: TauriFetch = async (url, init) => {
    calls.push({ url, method: init.method, headers: init.headers, body: init.body });
    const { status, body, headers = {} } = handler({ url, method: init.method, headers: init.headers, body: init.body });
    return {
      status,
      text: async () => body,
      headers: {
        forEach(cb) {
          for (const [k, v] of Object.entries(headers)) cb(v, k);
        },
      },
    };
  };
  return { fetchImpl, calls };
}

describe('TauriHttpTransport', () => {
  it('maps a GET request and folds response headers', async () => {
    const { fetchImpl, calls } = fakeFetch(() => ({
      status: 200,
      body: '{"ok":true}',
      headers: { 'content-type': 'application/json' },
    }));
    const transport = new TauriHttpTransport({ fetchImpl });

    const res = await transport.send({ method: 'GET', url: 'https://api.harvestapp.com/v2/users/me' });

    expect(calls[0]).toEqual({
      url: 'https://api.harvestapp.com/v2/users/me',
      method: 'GET',
      headers: undefined,
      body: undefined,
    });
    expect(res).toEqual({ status: 200, headers: { 'content-type': 'application/json' }, body: '{"ok":true}' });
  });

  it('maps POST/PATCH/DELETE with headers and body pass-through', async () => {
    for (const method of ['POST', 'PATCH', 'DELETE'] as const) {
      const { fetchImpl, calls } = fakeFetch(() => ({ status: 201, body: 'ok' }));
      const transport = new TauriHttpTransport({ fetchImpl });

      await transport.send({
        method,
        url: 'https://api.harvestapp.com/v2/time_entries',
        headers: { Authorization: 'Bearer t' },
        body: '{"hours":1}',
      });

      expect(calls[0]).toEqual({
        url: 'https://api.harvestapp.com/v2/time_entries',
        method,
        headers: { Authorization: 'Bearer t' },
        body: '{"hours":1}',
      });
    }
  });

  it('returns non-2xx responses normally, without throwing', async () => {
    const { fetchImpl } = fakeFetch(() => ({ status: 422, body: '{"error":"invalid"}' }));
    const transport = new TauriHttpTransport({ fetchImpl });

    const res = await transport.send({ method: 'POST', url: 'https://api.harvestapp.com/v2/time_entries' });

    expect(res).toEqual({ status: 422, headers: {}, body: '{"error":"invalid"}' });
  });

  it('wraps a thrown fetchImpl error in HttpTransportError', async () => {
    const fetchImpl: TauriFetch = async () => {
      throw new Error('network down');
    };
    const transport = new TauriHttpTransport({ fetchImpl });

    await expect(transport.send({ method: 'GET', url: 'https://dev.azure.com/x' })).rejects.toBeInstanceOf(
      HttpTransportError,
    );
    await expect(transport.send({ method: 'GET', url: 'https://dev.azure.com/x' })).rejects.toThrow('network down');
  });

  it('passes a dev.azure.com URL through verbatim (no proxy rewrite)', async () => {
    const { fetchImpl, calls } = fakeFetch(() => ({ status: 200, body: '[]' }));
    const transport = new TauriHttpTransport({ fetchImpl });

    await transport.send({ method: 'GET', url: 'https://dev.azure.com/org/project/_apis/wit/wiql' });

    expect(calls[0]?.url).toBe('https://dev.azure.com/org/project/_apis/wit/wiql');
  });
});
