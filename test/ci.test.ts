import { describe, expect, it } from "vitest";
import {
  buildCiContext,
  selectLatestStableReleases,
} from "../scripts/ci-discover.mjs";
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

    expect(context.channels).toEqual(["nightly", "compatibility"]);
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
