import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const config = JSON.parse(await readFile(join(root, "supabase/test-project.json"), "utf8"));
if (!/^[a-z]{20}$/.test(config.projectRef) || config.projectRef === config.productionProjectRef || config.projectUrl !== `https://${config.projectRef}.supabase.co`) {
  throw new Error("Die Testprojekt-Konfiguration ist ungültig oder verweist auf das Produktivprojekt.");
}
if (process.env.SPONSO_TEST_PROJECT_REF && process.env.SPONSO_TEST_PROJECT_REF !== config.projectRef) {
  throw new Error("Das angegebene Projekt stimmt nicht mit dem freigegebenen Testprojekt überein.");
}

function cli(args) {
  const result = spawnSync("supabase", args, { cwd: root, encoding: "utf8", timeout: 120000, maxBuffer: 8 * 1024 * 1024 });
  if (result.error) throw new Error("Die Supabase CLI muss installiert und angemeldet sein.", { cause: result.error });
  if (result.status !== 0) throw new Error(result.stderr.trim() || "Supabase-Abfrage fehlgeschlagen.");
  return JSON.parse(result.stdout);
}

// Verify the live project identity before sending any SQL. Never use an
// implicitly linked project or production environment variables.
const projects = cli(["projects", "list", "--output", "json"]);
const target = projects.find((project) => project.id === config.projectRef);
if (!target || target.name !== config.projectName) throw new Error("Das bestätigte Testprojekt wurde nicht gefunden.");

const temp = await mkdtemp(join(tmpdir(), "splow-sandbox-tap-"));
let failed = false;
let assertions = 0;
try {
  const files = (await readdir(join(root, "supabase/tests"))).filter((file) => file.endsWith(".test.sql")).sort();
  if (!files.length) throw new Error("Keine Datenbanktests gefunden.");
  for (const file of files) {
    try {
      let sql = await readFile(join(root, "supabase/tests", file), "utf8");
      if (!/^\s*begin;/i.test(sql) || !/rollback;\s*$/i.test(sql) || !/select\s+\*\s+from\s+finish\(\);/i.test(sql)) {
        throw new Error("Sandbox-Tests müssen mit BEGIN starten, finish() prüfen und mit ROLLBACK enden.");
      }
      // Capture pgTAP output because the Management API returns only the last
      // result set. Test statements and their transaction remain unchanged.
      sql = sql.replace(/^\s*begin;\s*/i, "begin;\ncreate temporary table sponso_test_tap (result text);\ngrant insert on pg_temp.sponso_test_tap to authenticated, service_role;\n");
      sql = sql.replace(/^select\s+(plan|is|isnt|ok|lives_ok|throws_ok|cmp_ok|results_eq|set_eq|has_table|has_column)\s*\(/gm, "insert into pg_temp.sponso_test_tap select $1(");
      sql = sql.replace(/select\s+\*\s+from\s+finish\(\);/i, "insert into pg_temp.sponso_test_tap select * from finish();\nselect result from pg_temp.sponso_test_tap;");
      const path = join(temp, file);
      await writeFile(path, sql);
      const response = cli(["db", "query", "--project-ref", config.projectRef, "--linked", "--file", path, "--output", "json"]);
      if (!Array.isArray(response.rows)) throw new Error("Unerwartetes Antwortformat der Datenbank.");
      const lines = response.rows.map((row) => row.result);
      const plan = lines.find((line) => /^1\.\.\d+$/.test(line));
      const count = lines.filter((line) => /^(?:not )?ok \d+/.test(line)).length;
      const diagnostics = lines.filter((line) => /^not ok |^#/.test(line));
      if (!plan || count !== Number(plan.slice(3)) || diagnostics.length) {
        throw new Error(`${count} Prüfergebnisse, Plan ${plan ?? "fehlt"}.\n${diagnostics.join("\n")}`);
      }
      assertions += count;
      console.log(`PASS ${file}: ${count} Prüfungen`);
    } catch (error) {
      failed = true;
      console.error(`FAIL ${file}: ${error.message}`);
    }
  }
  console.log(`${assertions} erfolgreiche Prüfungen im Testprojekt ${config.projectName}.`);
  process.exitCode = failed ? 1 : 0;
} finally {
  await rm(temp, { recursive: true, force: true });
}
