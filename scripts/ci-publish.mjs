import { readdir, readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const apiVersion = "2022-11-28";
const PROJECT_TAG_PATTERN = /^v\d+\.\d+\.\d+$/;

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
  return getOrCreateReleasePayload(
    repository,
    token,
    tag,
    releasePayload(tag, input),
  );
}

async function getOrCreateReleasePayload(repository, token, tag, payload) {
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
  try {
    return await api(repository, token, "/releases", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch (error) {
    const retry = await fetch(
      `https://api.github.com/repos/${repository}/releases/tags/${encodedTag}`,
      { headers: headers(token) },
    );
    if (retry.ok) return retry.json();
    throw error;
  }
}

export function releasePayload(tag, input) {
  return {
    tag_name: tag,
    target_commitish: input.target,
    name: input.name,
    body: input.body,
    prerelease: input.prerelease,
    make_latest: "false",
  };
}

export function isProjectTagPush({ eventName, refType, refName }) {
  return (
    eventName === "push" &&
    refType === "tag" &&
    PROJECT_TAG_PATTERN.test(refName ?? "")
  );
}

export function projectReleasePayload(tag, target) {
  return releasePayload(tag, {
    target,
    name: tag,
    body: "",
    prerelease: false,
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
  const targetRef = process.env.GITHUB_SHA ?? sourceRef;
  const sourceRefs = JSON.parse(process.env.RELEASE_SOURCE_REFS ?? "{}");
  const versions = (process.env.OPENCODE_VERSIONS ?? "")
    .split(",")
    .filter(Boolean);
  if (!repository || !token || channels.length === 0 || versions.length === 0)
    throw new Error("Release publishing environment is incomplete");

  if (
    isProjectTagPush({
      eventName: process.env.GITHUB_EVENT_NAME,
      refType: process.env.GITHUB_REF_TYPE,
      refName: process.env.GITHUB_REF_NAME,
    })
  ) {
    await getOrCreateReleasePayload(
      repository,
      token,
      process.env.GITHUB_REF_NAME,
      projectReleasePayload(process.env.GITHUB_REF_NAME, targetRef),
    );
  }

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
            target: targetRef,
            name: `OpenCode v${version} compatibility`,
            body: bodyFor(channel),
            prerelease: false,
          },
        );
        await replaceAssets(repository, token, release, files);
      }
      continue;
    }

    if (channel === "stable" || channel === "nightly") {
      const newest = versions[0];
      if (!newest)
        throw new Error(`Cannot publish ${channel} release without a version`);
      const marker = channel === "stable" ? "compatibility" : "nightly";
      const file = allFiles.find((entry) =>
        entry.name.includes(`-${marker}-opencode-${newest}.tgz`),
      );
      if (!file)
        throw new Error(`Missing ${marker} tarball for ${newest}`);
      const assetName =
        channel === "stable"
          ? "opencode-openrouter-metadata.tgz"
          : "opencode-openrouter-metadata-nightly.tgz";
      const release = await getOrCreateRelease(repository, token, channel, {
        target: targetRef,
        name: channel === "stable" ? "Stable" : "Nightly",
        body: bodyFor(channel),
        prerelease: channel === "nightly",
      });
      await replaceAssets(repository, token, release, [
        { name: assetName, path: file.path },
      ]);
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
      target: targetRef,
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

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
