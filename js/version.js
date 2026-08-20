/* Written by tools/stamp.mjs — see the header there for why the build is
   identified at commit time rather than at deploy time. `id` is a hash of the
   site's content, so it changes exactly when the code does. */

export const VERSION = {
  id: '0bd3ab6',
  builtAt: '2026-08-20T13:11:50Z',
};

/** "a1b2c3d · 20 Aug 14:32" for the splash, or just "dev" from an unstamped tree. */
export function versionLabel() {
  if (VERSION.id === 'dev') return 'dev build';
  const when = VERSION.builtAt
    ? new Date(VERSION.builtAt).toLocaleString([], {
      day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
    })
    : '';
  return when ? `${VERSION.id} · ${when}` : VERSION.id;
}

/**
 * Ask the server what the newest deployed build is. The running copy may be
 * served from the service worker cache, so this is the only way to know
 * whether a reload would get you something newer.
 */
export async function latestDeployed() {
  try {
    const res = await fetch(`version.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;   // offline, which is fine — the cached copy is the answer
  }
}
