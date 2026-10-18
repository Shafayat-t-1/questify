import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Static guard: Postgres forbids SQL parameters on trigger functions
 * (error 42P13). This greps every migration for a CREATE FUNCTION block
 * whose body is `RETURNS TRIGGER` but which declares a parameter list.
 */
describe("migrations: trigger functions must declare zero parameters", () => {
  const dir = join(process.cwd(), "supabase", "migrations");
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql"));

  it.each(files)("%s", (file) => {
    const sql = readFileSync(join(dir, file), "utf8");
    const re =
      /create\s+or\s+replace\s+function\s+[\w.]+\s*\(([^)]*)\)\s*returns\s+trigger/gi;
    const offenders = [...sql.matchAll(re)]
      .map((m) => m[1].trim())
      .filter((params) => params.length > 0);
    expect(offenders, `trigger function(s) with declared parameters in ${file}`).toEqual([]);
  });
});
