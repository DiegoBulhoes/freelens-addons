import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { stateFiles } from "../../src/main/state-file";

let root: string;
let folder: string;

beforeEach(async () => {
  root = await fs.mkdtemp(join(tmpdir(), "argocd-state-file-"));
  folder = join(root, "extension");
  await fs.mkdir(folder);
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
  vi.restoreAllMocks();
});

/** The name comes from another process: nothing but a bare state file may be touched. */
describe("main taking requests from the cluster frame", () => {
  it.each(["../escape.json", "nested/file.json", "289e8b234825329f053f98f8d145e660", "", 42])(
    "refuses %j as a file name, for reading and for writing",
    async (name) => {
      const files = stateFiles(async () => folder);

      await expect(files.read(name)).rejects.toThrow("refused operator state file name");
      await expect(files.write(name, "{}")).rejects.toThrow("refused operator state file name");
      expect(await fs.readdir(root)).toEqual(["extension"]);
      expect(await fs.readdir(folder)).toEqual([]);
    },
  );

  it("refuses a state that is not text, rather than writing its string form", async () => {
    const files = stateFiles(async () => folder);

    await expect(files.write("cluster.json", { pins: [] })).rejects.toThrow(
      "operator state must be text",
    );
    expect(await fs.readdir(folder)).toEqual([]);
  });

  it("reads back exactly the text it wrote", async () => {
    const files = stateFiles(async () => folder);

    await files.write("cluster.json", '{ "a": 1 }');

    expect(await files.read("cluster.json")).toBe('{ "a": 1 }');
  });
});
