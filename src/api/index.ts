import type { LoaderType } from '../types.ts';

const USER_AGENT = 'tumbleweed-mc/0.1 (https://github.com/Tumbleweed-MC)';

export interface FetchOptions {
  method?: 'GET' | 'HEAD';
  headers?: Record<string, string>;
  timeoutMs?: number;
  /** 重试次数，默认 1（即失败一次就放弃；多镜像请用 fetchWithMirrors） */
  retries?: number;
}

/** 合并默认 UA 头 */
export function buildHeaders(custom?: Record<string, string>): Record<string, string> {
  return { 'User-Agent': USER_AGENT, Accept: 'application/json', ...custom };
}

async function abortAfter(ms: number): Promise<AbortController> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  // 让 abort 后 setTimeout 不再持有事件循环
  t.unref?.();
  return ctrl;
}

export async function fetchWithRetry(url: string, opts: FetchOptions = {}): Promise<Response> {
  const retries = opts.retries ?? 1;
  const timeoutMs = opts.timeoutMs ?? 30_000;
  let lastErr: unknown;
  for (let i = 0; i <= retries; i++) {
    const ctrl = await abortAfter(timeoutMs);
    try {
      const r = await fetch(url, {
        method: opts.method ?? 'GET',
        headers: buildHeaders(opts.headers),
        signal: ctrl.signal,
      });
      return r;
    } catch (e) {
      lastErr = e;
      if (i < retries) await sleep(2 ** i * 500);
    }
  }
  throw new Error(
    `fetch failed after ${retries + 1} attempts: ${url} — ${(lastErr as Error)?.message ?? lastErr}`,
  );
}

/**
 * 顺序尝试一组镜像 URL，第一个返回 2xx 即返回。
 * 404 在下一个镜像也被视为不可用。
 * 5xx / 网络错误同样回退到下一个镜像。
 */
export async function fetchWithMirrors(
  mirrors: string[],
  opts: FetchOptions = {},
): Promise<{ response: Response; url: string }> {
  let lastErr: unknown;
  for (const url of mirrors) {
    try {
      const r = await fetchWithRetry(url, { ...opts, retries: 0 });
      if (r.ok) return { response: r, url };
      if (r.status === 404) {
        // 下一镜像
        continue;
      }
      // 5xx 也试下一镜像
      if (r.status >= 500) {
        lastErr = new Error(`${r.status} ${r.statusText}`);
        continue;
      }
      // 4xx 直接返回原 response，由调用方处理
      return { response: r, url };
    } catch (e) {
      lastErr = e;
    }
  }
  throw new Error(
    `all mirrors failed: ${mirrors.join(' | ')} — ${(lastErr as Error)?.message ?? lastErr}`,
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** 标识 loader signature 在 UA 头里方便 server 端分类 */
export function uaForLoader(t: LoaderType): string {
  return `tumbleweed-mc/0.1 (${t} loader; https://github.com/Tumbleweed-MC)`;
}
