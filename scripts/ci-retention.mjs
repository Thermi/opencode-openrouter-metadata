import { pathToFileURL } from "node:url";

const DEFAULT_THRESHOLD_BYTES = 200_000_000;
const COMPATIBILITY_TAG = /^opencode-v\d+\.\d+\.\d+$/;
const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;

function assetBytes(release) {
  return (release.assets ?? []).reduce(
    (total, asset) => total + (Number.isFinite(asset.size) ? asset.size : 0),
    0,
  );
}

function compatibilityReleases(releases) {
  return releases
    .filter((release) => COMPATIBILITY_TAG.test(release.tag_name ?? ""))
    .sort(
      (left, right) =>
        new Date(right.created_at).getTime() -
        new Date(left.created_at).getTime(),
    );
}

export function planRetention(
  releases,
  { now = new Date(), thresholdBytes = DEFAULT_THRESHOLD_BYTES } = {},
) {
  const candidates = compatibilityReleases(releases);
  const deletions = [];
  const remaining = [...candidates];
  const cutoff = now.getTime() - ONE_YEAR_MS;

  for (const release of [...remaining].reverse()) {
    if (remaining.length <= 3) break;
    if (new Date(release.created_at).getTime() < cutoff) {
      deletions.push({
        id: release.id,
        tag_name: release.tag_name,
        reason: "older-than-one-year",
      });
      remaining.splice(remaining.indexOf(release), 1);
    }
  }

  let bytes = remaining.reduce(
    (total, release) => total + assetBytes(release),
    0,
  );
  for (const release of [...remaining].reverse()) {
    if (bytes <= thresholdBytes || remaining.length <= 3) break;
    deletions.push({
      id: release.id,
      tag_name: release.tag_name,
      reason: "storage-threshold",
    });
    bytes -= assetBytes(release);
    remaining.splice(remaining.indexOf(release), 1);
  }

  return {
    deletions,
    remaining: remaining.map((release) => release.tag_name),
    bytes,
    thresholdBytes,
    warning: bytes > thresholdBytes && remaining.length <= 3,
  };
}

async function fetchReleases(repository, token) {
  const releases = [];
  for (let page = 1; ; page += 1) {
    const response = await fetch(
      `https://api.github.com/repos/${repository}/releases?per_page=100&page=${page}`,
      {
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${token}`,
          "X-GitHub-Api-Version": "2022-11-28",
        },
      },
    );
    if (!response.ok)
      throw new Error(
        `GitHub releases request failed with HTTP ${response.status}`,
      );
    const pageReleases = await response.json();
    if (!Array.isArray(pageReleases) || pageReleases.length === 0) break;
    releases.push(...pageReleases);
    if (pageReleases.length < 100) break;
  }
  return releases;
}

async function main() {
  const repository = process.env.GITHUB_REPOSITORY;
  const token = process.env.GITHUB_TOKEN;
  if (!repository || !token)
    throw new Error("GITHUB_REPOSITORY and GITHUB_TOKEN are required");
  const thresholdBytes = Number(
    process.env.RELEASE_STORAGE_THRESHOLD_BYTES ?? DEFAULT_THRESHOLD_BYTES,
  );
  if (!Number.isFinite(thresholdBytes) || thresholdBytes < 0)
    throw new Error("Invalid RELEASE_STORAGE_THRESHOLD_BYTES");

  const releases = await fetchReleases(repository, token);
  const plan = planRetention(releases, { thresholdBytes });
  console.log(JSON.stringify(plan, null, 2));
  if (process.env.RELEASE_RETENTION_DRY_RUN === "true") return;

  for (const deletion of plan.deletions) {
    const response = await fetch(
      `https://api.github.com/repos/${repository}/releases/${deletion.id}`,
      {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
      },
    );
    if (!response.ok)
      throw new Error(
        `Failed to delete ${deletion.tag_name}: HTTP ${response.status}`,
      );
  }
  if (plan.warning)
    console.warn(
      "Release assets remain above the threshold because the three-release minimum was reached.",
    );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
