/** Tiny HTTP helper shared by the seed and load-test scripts. */
export const BASE_URL = (process.env.API_URL ?? 'http://localhost:8080').replace(/\/$/, '');

export interface Result<T = any> {
  status: number;
  body: { data?: T; error?: { code: string; message: string } };
  ms: number;
}

export async function api<T = any>(
  method: string,
  path: string,
  opts: { body?: unknown; token?: string; headers?: Record<string, string> } = {},
): Promise<Result<T>> {
  const started = performance.now();
  const res = await fetch(`${BASE_URL}/api/v1${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(opts.token && { authorization: `Bearer ${opts.token}` }),
      ...opts.headers,
    },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  const body = res.status === 204 ? {} : await res.json().catch(() => ({}));
  return { status: res.status, body, ms: performance.now() - started };
}

export async function must<T = any>(label: string, promise: Promise<Result<T>>): Promise<T> {
  const r = await promise;
  if (r.status >= 300) throw new Error(`${label} failed: ${r.status} ${JSON.stringify(r.body.error)}`);
  return r.body.data as T;
}

export async function adminToken(): Promise<string> {
  const email = process.env.ADMIN_EMAIL ?? 'admin@evently.dev';
  const password = process.env.ADMIN_PASSWORD ?? 'admin12345';
  const session = await must<{ token: string }>('admin login', api('POST', '/auth/login', { body: { email, password } }));
  return session.token;
}

/** Logs in, or registers if the account doesn't exist yet. */
export async function userToken(email: string, name: string, password = 'password123'): Promise<string> {
  const login = await api<{ token: string }>('POST', '/auth/login', { body: { email, password } });
  if (login.status === 200) return login.body.data!.token;
  return (await must<{ token: string }>(`register ${email}`, api('POST', '/auth/register', { body: { email, name, password } }))).token;
}

export const daysFromNow = (days: number, hour = 19) => {
  const d = new Date(Date.now() + days * 86_400_000);
  d.setUTCHours(hour, 0, 0, 0);
  return d.toISOString();
};
