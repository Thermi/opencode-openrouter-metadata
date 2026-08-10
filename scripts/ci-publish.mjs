import { readdir, readFile } from "node:fs/promises";

const apiVersion = "2022-11-28";

function headers(token, extra = {}) {
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "X-GitHub-Api-Version": apiVersion,
    ...extra,
  };
}

async function api(repository, token, path, options = {}) {
  const response = await fetch(
    `https://api.github.com/repos/${repository}${path}`,
    {
      ...options,
      headers: headers(token, options.headers),
    },
  );
  if (!response.ok)
    throw new Error(
      `GitHub API ${options.method ?? "GET"} ${path} failed with HTTP ${response.status}: ${await response.text()}`,
    );
  return response.status === 204 ? undefined : response.json();
}

async function getOrCreateRelease(repository, token, tag, input) {
  const encodedTag = encodeURIComponent(tag);
  const existing = await fetch(
    `https://api.github.com/repos/${repository}/releases/tags/${encodedTag}`,
    { headers: headers(token) },
  );
  if (existing.ok) return existing.json();
  if (existing.status !== 404)
    throw new Error(
      `Failed to inspect release ${tag}: HTTP ${existing.status}`,
    );
  return api(repository, token, "/releases", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      tag_name: tag,
      target_commitish: input.target,
      name: input.name,
      body: input.body,
      prerelease: input.prerelease,
      make_latest: false,
    }),
  });
}

async function replaceAssets(repository, token, release, files) {
  if (files.length === 0)
    throw new Error(
      `No package assets were produced for release ${release.tag_name}`,
    );
  for (const asset of release.assets ?? []) {
    await api(repository, token, `/releases/assets/${asset.id}`, {
      method: "DELETE",
    });
  }
  const uploadUrl = release.upload_url.replace(/\{\?.*$/, "");
  for (const file of files) {
    const data = await readFile(file.path);
    const response = await fetch(
      `${uploadUrl}?name=${encodeURIComponent(file.name)}`,
      {
        method: "POST",
        headers: headers(token, {
          "Content-Type": "application/gzip",
          "Content-Length": String(data.length),
        }),
        body: data,
      },
    );
    if (!response.ok)
      throw new Error(`Failed to upload ${file.name}: HTTP ${response.status}`);
  }
}

function releaseBody(channel, sourceRef, versions, sha) {
  return [
    `Built channel: ${channel}`,
    `Project source: ${sourceRef}`,
    `Project commit: ${sha}`,
    `OpenCode schema versions: ${versions.join(", ")}`,
    "Generated from the matching OpenCode release tags.",
  ].join("\n");
}

async function main() {
  const repository = process.env.GITHUB_REPOSITORY;
  const token = process.env.GITHUB_TOKEN;
  const artifactDirectory =
    process.env.RELEASE_ARTIFACT_DIRECTORY ?? "release-assets";
  const channels = (process.env.RELEASE_CHANNELS ?? "")
    .split(",")
    .filter(Boolean);
  const sourceRef = process.env.RELEASE_SOURCE_REF ?? process.env.GITHUB_SHA;
  const sourceRefs = JSON.parse(process.env.RELEASE_SOURCE_REFS ?? "{}");
  const versions = (process.env.OPENCODE_VERSIONS ?? "")
    .split(",")
    .filter(Boolean);
  if (!repository || !token || channels.length === 0 || versions.length === 0)
    throw new Error("Release publishing environment is incomplete");

  const allFiles = (await readdir(artifactDirectory, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith(".tgz"))
    .map((entry) => ({
      name: entry.name,
      path: `${artifactDirectory}/${entry.name}`,
    }));
  const bodyFor = (channel) =>
    releaseBody(
      channel,
      sourceRefs[channel] ?? sourceRef,
      versions,
      process.env.GITHUB_SHA ?? "unknown",
    );

  for (const channel of channels) {
    if (channel === "compatibility") {
      for (const version of versions) {
        const files = allFiles.filter((file) =>
          file.name.includes(`-compatibility-opencode-${version}.tgz`),
        );
        const release = await getOrCreateRelease(
          repository,
          token,
          `opencode-v${version}`,
          {
            target: sourceRef,
            name: `OpenCode v${version} compatibility`,
            body: bodyFor(channel),
            prerelease: false,
          },
        );
        await replaceAssets(repository, token, release, files);
      }
      continue;
    }

    const files = allFiles.filter((file) =>
      file.name.includes(`-${channel}-opencode-`),
    );
    const tag =
      channel === "nightly"
        ? "nightly"
        : channel === "stable"
          ? "stable"
          : process.env.GITHUB_REF_NAME;
    if (!tag)
      throw new Error(`No release tag is available for channel ${channel}`);
    const release = await getOrCreateRelease(repository, token, tag, {
      target: sourceRef,
      name:
        channel === "nightly"
          ? "Nightly"
          : channel === "stable"
            ? "Stable"
            : `Release ${tag}`,
      body: bodyFor(channel),
      prerelease: channel === "nightly",
    });
    await replaceAssets(repository, token, release, files);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
