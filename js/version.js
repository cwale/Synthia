/* Stamped by the Pages workflow at deploy time — see .github/workflows/pages.yml.
   The committed values are what you get when running locally from a clone. */

export const VERSION = {
  sha: 'dev',
  builtAt: '',
};

/** "a1b2c3d · 20 Aug 14:32" for the splash, or just "dev" locally. */
export function versionLabel() {
  if (VERSION.sha === 'dev') return 'dev build';
  const when = VERSION.builtAt
    ? new Date(VERSION.builtAt).toLocaleString([], {
      day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
    })
    : '';
  return when ? `${VERSION.sha} · ${when}` : VERSION.sha;
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
