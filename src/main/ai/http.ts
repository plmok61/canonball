import type { FetchFn, ProviderConfig } from './adapter'
import { httpError, networkError } from './errors'

/** Sends a request and maps network and HTTP failures to writer-facing ProviderErrors. */
export async function send(
  cfg: ProviderConfig,
  fetchFn: FetchFn,
  url: string,
  init: RequestInit
): Promise<Response> {
  let res: Response
  try {
    res = await fetchFn(url, init)
  } catch (err) {
    throw networkError(cfg.provider, err, cfg.baseUrl)
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw httpError(cfg.provider, res.status, text)
  }
  return res
}

/** Reads a JSON body, mapping a broken body to a network error. */
export async function readJson(cfg: ProviderConfig, res: Response): Promise<unknown> {
  try {
    return await res.json()
  } catch (err) {
    throw networkError(cfg.provider, err, cfg.baseUrl)
  }
}
