import type { HttpRequest, HttpResponse, IHttpTransport } from '@domain/ports';

interface Stub {
  match: (req: HttpRequest) => boolean;
  respond: (req: HttpRequest) => HttpResponse;
}

/** Scriptable IHttpTransport double for unit tests. Records every request. */
export class FakeTransport implements IHttpTransport {
  readonly requests: HttpRequest[] = [];
  private readonly stubs: Stub[] = [];

  on(method: HttpRequest['method'], urlIncludes: string, body: unknown, status = 200): this {
    this.stubs.push({
      match: (r) => r.method === method && r.url.includes(urlIncludes),
      respond: () => ({
        status,
        headers: { 'content-type': 'application/json' },
        body: typeof body === 'string' ? body : JSON.stringify(body),
      }),
    });
    return this;
  }

  async send(request: HttpRequest): Promise<HttpResponse> {
    this.requests.push(request);
    const stub = this.stubs.find((s) => s.match(request));
    if (!stub) {
      return { status: 404, headers: {}, body: `{"error":"no stub for ${request.method} ${request.url}"}` };
    }
    return stub.respond(request);
  }

  lastRequest(): HttpRequest {
    const last = this.requests[this.requests.length - 1];
    if (!last) throw new Error('no requests recorded');
    return last;
  }

  requestMatching(urlIncludes: string): HttpRequest {
    const found = [...this.requests].reverse().find((r) => r.url.includes(urlIncludes));
    if (!found) throw new Error(`no request matching ${urlIncludes}`);
    return found;
  }
}
