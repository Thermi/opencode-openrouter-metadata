import { pathToFileURL } from "node:url";

const VERSION_PATTERN = /^v(\d+)\.(\d+)\.(\d+)$/;

function versionParts(tag) {
  const match = VERSION_PATTERN.exec(tag ?? "");
  return match ? match.slice(1).map(Number) : undefined;
}

function compareVersions(left, right) {
  const leftParts = versionParts(left.tag_name);
  const rightParts = versionParts(right.tag_name);
  if (!leftParts || !rightParts) return 0;
  for (let index = 0; index < leftParts.length; index += 1) {
    if (leftParts[index] !== rightParts[index])
      return rightParts[index] - leftParts[index];
  }
  return 0;
}

export function selectLatestStableReleases(releases, count = 3) {
  return releases
    .filter(
      (release) =>
        !release.draft &&
        !release.prerelease &&
        VERSION_PATTERN.test(release.tag_name ?? ""),
    )
    .sort(compareVersions)
    .slice(0, count)
    .map((release) => release.tag_name.slice(1));
}

export function selectLatestProjectRelease(releases) {
  return selectLatestStableReleases(releases, 1)[0];
}

async function fetchReleases(repository, token) {
  const releases = [];
  for (let page = 1; ; page += 1) {
    const response = await fetch(
      `https://api.github.com/repos/${repository}/releases?per_page=100&page=${page}`,
      {
        headers: {
          Accept: "application/vnd.github+json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
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

function targetEntries(channel, sourceRef, versions) {
  return versions.map((opencodeVersion) => ({
    channel,
    source_ref: sourceRef,
    opencode_version: opencodeVersion,
  }));
}

export function buildCiContext({
  eventName,
  refType,
  refName,
  sha,
  mode,
  upstreamVersions,
  projectVersion,
}) {
  const versions = upstreamVersions;
  const include = [];
  let channels = [];
  let publish = false;

  if (
    eventName === "push" &&
    refType === "tag" &&
    VERSION_PATTERN.test(refName ?? "")
  ) {
    include.push(...targetEntries("stable", refName, versions));
    include.push(...targetEntries("versioned", refName, versions));
    include.push(...targetEntries("compatibility", refName, versions));
    channels = ["stable", "versioned", "compatibility"];
    publish = true;
  } else if (
    eventName === "schedule" ||
    (eventName === "workflow_dispatch" && mode !== "stable")
  ) {
    include.push(...targetEntries("nightly", "main", versions));
    channels = ["nightly"];
    publish = true;
    if (projectVersion) {
      include.push(
        ...targetEntries("compatibility", `v${projectVersion}`, versions),
      );
      channels.push("compatibility");
    }
  } else if (eventName === "workflow_dispatch" && mode === "stable") {
    if (!projectVersion)
      throw new Error(
        "No declared project release is available for the stable build",
      );
    include.push(...targetEntries("stable", `v${projectVersion}`, versions));
    include.push(
      ...targetEntries("compatibility", `v${projectVersion}`, versions),
    );
    channels = ["stable", "compatibility"];
    publish = true;
  } else {
    include.push(
      ...targetEntries(
        "ci",
        eventName === "pull_request" ? sha : "main",
        versions,
      ),
    );
    channels = ["ci"];
  }

  const sourceRefs = Object.fromEntries(
    channels
      .map((channel) => [
        channel,
        include.find((entry) => entry.channel === channel)?.source_ref,
      ])
      .filter(([, ref]) => ref),
  );
  return { matrix: { include }, channels, sourceRefs, publish };
}

async function main() {
  const upstreamRepository =
    process.env.OPENCODE_REPOSITORY ?? "anomalyco/opencode";
  const projectRepository = process.env.GITHUB_REPOSITORY;
  const token = process.env.GITHUB_TOKEN;
  if (!projectRepository) throw new Error("GITHUB_REPOSITORY is required");

  const upstreamReleases = await fetchReleases(upstreamRepository, token);
  const upstreamVersions = selectLatestStableReleases(upstreamReleases, 3);
  if (upstreamVersions.length < 3)
    throw new Error("Fewer than three stable OpenCode releases were found");

  const projectReleases = await fetchReleases(projectRepository, token);
  const projectVersion = selectLatestProjectRelease(projectReleases);
  const context = buildCiContext({
    eventName: process.env.GITHUB_EVENT_NAME,
    refType: process.env.GITHUB_REF_TYPE,
    refName: process.env.GITHUB_REF_NAME,
    sha: process.env.GITHUB_SHA,
    mode: process.env.CI_CHANNEL ?? "nightly",
    upstreamVersions,
    projectVersion,
  });

  if (
    !projectVersion &&
    (process.env.GITHUB_EVENT_NAME === "schedule" ||
      process.env.CI_CHANNEL !== "nightly")
  ) {
    console.error(
      "No declared project release exists; compatibility/stable publishing will be skipped.",
    );
  }
  process.stdout.write(
    JSON.stringify({ ...context, upstreamVersions, projectVersion }),
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
