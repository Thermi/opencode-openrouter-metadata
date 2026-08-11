import { describe, expect, it } from "vitest";
import {
  buildCiContext,
  selectLatestStableReleases,
  selectUnbuiltVersions,
} from "../scripts/ci-discover.mjs";
import {
  isProjectTagPush,
  projectReleaseTag,
  projectReleasePayload,
  releaseUpdatePayload,
  releasePayload,
} from "../scripts/ci-publish.mjs";
import { planRetention } from "../scripts/ci-retention.mjs";

describe("CI release discovery", () => {
  it("selects the newest three stable semantic releases", () => {
    expect(
      selectLatestStableReleases([
        { tag_name: "v1.18.13", draft: false, prerelease: false },
        { tag_name: "v1.18.15", draft: false, prerelease: false },
        { tag_name: "v1.18.14", draft: false, prerelease: false },
        { tag_name: "v1.19.0-rc.1", draft: false, prerelease: true },
        { tag_name: "v1.18.12", draft: true, prerelease: false },
      ]),
    ).toEqual(["1.18.15", "1.18.14", "1.18.13"]);
  });

  it("uses main for nightly and the declared project tag for compatibility builds", () => {
    const context = buildCiContext({
      eventName: "schedule",
      refType: "branch",
      refName: "main",
      sha: "abc123",
      mode: "nightly",
      upstreamVersions: ["1.18.15", "1.18.14", "1.18.13"],
      projectVersion: "0.1.2",
    });

    expect(context.channels).toEqual([
      "nightly",
      "compatibility",
      "stable",
    ]);
    expect(context.matrix.include).toContainEqual({
      channel: "nightly",
      source_ref: "main",
      opencode_version: "1.18.15",
    });
    expect(context.matrix.include).toContainEqual({
      channel: "compatibility",
      source_ref: "v0.1.2",
      opencode_version: "1.18.13",
    });
    expect(context.sourceRefs.stable).toBe("v0.1.2");
    expect(context.publish).toBe(true);
  });

  it("skips versions that already have a compatibility release", () => {
    expect(
      selectUnbuiltVersions(
        ["1.18.16", "1.18.15", "1.18.14"],
        ["opencode-v1.18.15", "opencode-v1.18.13"],
      ),
    ).toEqual(["1.18.16", "1.18.14"]);
  });

  it("produces an empty matrix when every version already has a compatibility release", () => {
    const context = buildCiContext({
      eventName: "schedule",
      refType: "branch",
      refName: "main",
      sha: "abc123",
      mode: "nightly",
      upstreamVersions: ["1.18.15", "1.18.14", "1.18.13"],
      projectVersion: "0.1.2",
      existingReleaseTags: [
        "opencode-v1.18.15",
        "opencode-v1.18.14",
        "opencode-v1.18.13",
      ],
    });

    expect(context.matrix.include).toEqual([]);
    expect(context.channels).toEqual(["nightly", "compatibility", "stable"]);
    expect(context.publish).toBe(false);
  });

  it("drops the redundant versioned channel on project tag pushes", () => {
    const context = buildCiContext({
      eventName: "push",
      refType: "tag",
      refName: "v0.1.2",
      sha: "abc123",
      mode: "nightly",
      upstreamVersions: ["1.18.15", "1.18.14", "1.18.13"],
      projectVersion: "0.1.1",
    });

    expect(context.channels).toEqual(["stable", "compatibility"]);
    expect(
      context.matrix.include.every((entry) => entry.channel === "compatibility"),
    ).toBe(true);
    expect(context.sourceRefs.stable).toBe("v0.1.2");
  });
});

describe("CI release publishing", () => {
  it("recognizes only semver project tag pushes", () => {
    expect(
      isProjectTagPush({
        eventName: "push",
        refType: "tag",
        refName: "v0.1.3",
      }),
    ).toBe(true);
    expect(
      isProjectTagPush({
        eventName: "schedule",
        refType: "branch",
        refName: "main",
      }),
    ).toBe(false);
    expect(
      isProjectTagPush({
        eventName: "push",
        refType: "tag",
        refName: "opencode-v1.18.16",
      }),
    ).toBe(false);
  });

  it("uses the stable source ref to reconcile project releases", () => {
    expect(
      projectReleaseTag({
        eventName: "workflow_dispatch",
        refType: "branch",
        refName: "main",
        stableRef: "v0.1.3",
      }),
    ).toBe("v0.1.3");
    expect(
      projectReleaseTag({
        eventName: "schedule",
        refType: "branch",
        refName: "main",
        stableRef: "stable",
      }),
    ).toBeUndefined();
  });

  it("builds a normal project release payload", () => {
    expect(projectReleasePayload("v0.1.3", "92a936f")).toEqual({
      tag_name: "v0.1.3",
      target_commitish: "92a936f",
      name: "v0.1.3",
      body: "Project release v0.1.3\nProject source: 92a936f",
      prerelease: false,
      make_latest: "false",
    });
  });

  it("does not change the target when updating an existing release", () => {
    expect(
      releaseUpdatePayload({
        tag_name: "v0.1.3",
        target_commitish: "v0.1.3",
        name: "v0.1.3",
        body: "body",
        prerelease: false,
        make_latest: "false",
      }),
    ).toEqual({
      tag_name: "v0.1.3",
      name: "v0.1.3",
      body: "body",
      prerelease: false,
      make_latest: "false",
    });
  });

  it("uses GitHub release property types accepted by the Releases API", () => {
    expect(
      releasePayload("stable", {
        target: "main",
        name: "Stable",
        body: "body",
        prerelease: false,
      }),
    ).toMatchObject({
      tag_name: "stable",
      make_latest: "false",
    });
  });
});

describe("CI release retention", () => {
  it("removes old compatibility releases but preserves the newest three", () => {
    const result = planRetention(
      [
        {
          id: 1,
          tag_name: "opencode-v1.18.12",
          created_at: "2024-01-01T00:00:00Z",
          assets: [{ size: 100 }],
        },
        {
          id: 2,
          tag_name: "opencode-v1.18.13",
          created_at: "2026-08-01T00:00:00Z",
          assets: [{ size: 60 }],
        },
        {
          id: 3,
          tag_name: "opencode-v1.18.14",
          created_at: "2026-08-02T00:00:00Z",
          assets: [{ size: 60 }],
        },
        {
          id: 4,
          tag_name: "opencode-v1.18.15",
          created_at: "2026-08-03T00:00:00Z",
          assets: [{ size: 60 }],
        },
      ],
      { now: new Date("2026-08-10T00:00:00Z"), thresholdBytes: 200 },
    );

    expect(result.deletions).toEqual([
      { id: 1, tag_name: "opencode-v1.18.12", reason: "older-than-one-year" },
    ]);
    expect(result.remaining).toEqual([
      "opencode-v1.18.15",
      "opencode-v1.18.14",
      "opencode-v1.18.13",
    ]);
  });

  it("stops at three releases when the storage threshold still cannot be met", () => {
    const releases = ["12", "13", "14", "15"].map((version, index) => ({
      id: index + 1,
      tag_name: `opencode-v1.18.${version}`,
      created_at: `2026-08-0${index + 1}T00:00:00Z`,
      assets: [{ size: 60 }],
    }));

    const result = planRetention(releases, {
      now: new Date("2026-08-10T00:00:00Z"),
      thresholdBytes: 150,
    });

    expect(result.deletions).toEqual([
      { id: 1, tag_name: "opencode-v1.18.12", reason: "storage-threshold" },
    ]);
    expect(result.remaining).toHaveLength(3);
    expect(result.warning).toBe(true);
  });
});
