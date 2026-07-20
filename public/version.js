export const APP_VERSION = "0.0.20";
export const GITHUB_REPOSITORY = "MagicKong21/market-pulse-dashboard";
export const RELEASES_URL = `https://github.com/${GITHUB_REPOSITORY}/releases`;
export const LATEST_RELEASE_API = `https://api.github.com/repos/${GITHUB_REPOSITORY}/releases/latest`;

export function normalizeVersion(value) {
  const match = String(value || "").trim().match(/^v?(\d+)\.(\d+)\.(\d+)$/i);
  return match ? match.slice(1).map(Number) : null;
}

export function isNewerVersion(candidate, current) {
  const next = normalizeVersion(candidate), installed = normalizeVersion(current);
  if (!next || !installed) return false;
  for (let index = 0; index < 3; index += 1) {
    if (next[index] !== installed[index]) return next[index] > installed[index];
  }
  return false;
}
