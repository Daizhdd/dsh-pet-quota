/**
 * dsh-pet-quota — loader entry.
 *
 * This file is deliberately a shim. The harness's loader caches an imported
 * plugin module by URL for the life of the process, so a host half edited on
 * disk would keep running the previous build until the whole app restarts. This
 * entry imports the real implementation with a fresh query stamp on every
 * apply, which means "disable and re-enable the plugin" always picks up the
 * code now on disk.
 *
 * The implementation lives in `host.js`; the contract with the loader is the
 * same either way (`name`, `inject`, `apply`).
 *
 * @module dsh-pet-quota
 */

export const name = 'pet-quota'

/** No hard dependency: the implementation reads every facility opportunistically. */
export const inject = []

export async function apply(ctx, config = {}) {
  const url = new URL('./host.js', import.meta.url)
  url.searchParams.set('build', String(Date.now()))
  const impl = await import(url.href)
  return impl.apply(ctx, config)
}

