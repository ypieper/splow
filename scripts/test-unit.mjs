import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";

const require = createRequire(import.meta.url);
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const output = await mkdtemp(join(tmpdir(), "splow-unit-tests-"));
try {
  const compilation = spawnSync(process.execPath, [require.resolve("typescript/bin/tsc"), "-p", "tsconfig.tests.json", "--outDir", output], { cwd: root, stdio: "inherit" });
  if (compilation.error) throw compilation.error;
  if (compilation.status !== 0) process.exitCode = compilation.status ?? 1;
  else {
    const files = (await readdir(join(output, "tests"))).filter((file) => file.endsWith(".test.js")).map((file) => join(output, "tests", file));
    if (!files.length) throw new Error("Keine Unit-Tests gefunden.");
    const tests = spawnSync(process.execPath, ["--test", ...files], { cwd: root, stdio: "inherit" });
    if (tests.error) throw tests.error;
    process.exitCode = tests.status ?? 1;
  }
} finally {
  await rm(output, { recursive: true, force: true });
}
