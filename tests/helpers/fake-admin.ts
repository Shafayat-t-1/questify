/**
 * Minimal in-memory stand-in for the Supabase service-role client used by tests.
 *
 * It deliberately implements ONLY the query shapes the routes under test use
 * (`select(...).eq(...).maybeSingle()`, conditional
 * `update(...).eq(...).is(...).gte(...).select()` one-time claims, simple
 * `order/limit/range`, `upsert`),
 * so route wiring can be exercised without a database. The money RPCs are
 * provided per-test via `rpcHandler`, which mirrors the SQL semantics so the
 * route contract can be asserted. This does NOT execute the real migrations —
 * see REPORT_PHASE2.md for what still requires a live Postgres.
 */

export type Row = Record<string, unknown>;
export type RpcResult = { data: unknown; error: { message: string } | null };

export class FakeAdmin {
  tables: Record<string, Row[]> = {};
  upserts: Array<{ table: string; rows: Row[] }> = [];
  rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];

  rpcHandler: (name: string, args: Record<string, unknown>) => Promise<RpcResult> = async () => ({
    data: null,
    error: null,
  });

  async rpc(name: string, args: Record<string, unknown> = {}): Promise<RpcResult> {
    this.rpcCalls.push({ name, args });
    return this.rpcHandler(name, args);
  }

  from(table: string): QueryBuilder {
    return new QueryBuilder(this, table);
  }
}

type Mode = "select" | "upsert" | "update";
type FilterOp = "eq" | "is" | "gte";
interface Filter {
  op: FilterOp;
  col: string;
  value: unknown;
}

export class QueryBuilder implements PromiseLike<RpcResult> {
  private filters: Filter[] = [];
  private mode: Mode = "select";
  private payload: Row[] = [];
  private singleRow = false;
  private maybe = false;

  constructor(
    private db: FakeAdmin,
    private table: string,
  ) {}

  select(_cols?: string | string[]): this {
    void _cols;
    return this;
  }

  eq(col: string, value: unknown): this {
    this.filters.push({ op: "eq", col, value });
    return this;
  }

  /** PostgREST `.is(col, null)` — used by one-time-claim guards. */
  is(col: string, value: unknown): this {
    this.filters.push({ op: "is", col, value });
    return this;
  }

  /** PostgREST `.gte(col, value)` — ISO timestamp strings compare correctly. */
  gte(col: string, value: unknown): this {
    this.filters.push({ op: "gte", col, value });
    return this;
  }

  order(): this {
    return this;
  }

  limit(): this {
    return this;
  }

  range(): this {
    return this;
  }

  insert(rows: Row | Row[]): this {
    this.mode = "upsert";
    this.payload = Array.isArray(rows) ? rows : [rows];
    return this;
  }

  update(rows: Row): this {
    this.mode = "update";
    this.payload = [rows];
    return this;
  }

  upsert(rows: Row | Row[], _opts?: { onConflict?: string }): this {
    void _opts;
    this.mode = "upsert";
    this.payload = Array.isArray(rows) ? rows : [rows];
    return this;
  }

  maybeSingle(): Promise<RpcResult> {
    this.maybe = true;
    return Promise.resolve(this.resolve());
  }

  single(): Promise<RpcResult> {
    this.singleRow = true;
    return Promise.resolve(this.resolve());
  }

  then<TResult1 = RpcResult, TResult2 = never>(
    onfulfilled?: ((value: RpcResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.resolve()).then(onfulfilled, onrejected);
  }

  private matches(row: Row): boolean {
    return this.filters.every(({ op, col, value }) => {
      const current = row[col];
      if (op === "eq") return current === value;
      if (op === "is") return value === null ? current === null || current === undefined : current === value;
      return (
        (typeof current === "string" || typeof current === "number") &&
        (typeof value === "string" || typeof value === "number") &&
        current >= value
      );
    });
  }

  private resolve(): RpcResult {
    if (this.mode === "upsert") {
      this.db.tables[this.table] = this.db.tables[this.table] ?? [];
      for (const row of this.payload) {
        const idx = this.db.tables[this.table].findIndex((r) => r.user_id === row.user_id);
        if (idx >= 0) this.db.tables[this.table][idx] = { ...this.db.tables[this.table][idx], ...row };
        else this.db.tables[this.table].push({ ...row });
      }
      this.db.upserts.push({ table: this.table, rows: this.payload });
      return { data: this.payload, error: null };
    }

    if (this.mode === "update") {
      // Conditional UPDATE: filters are the SQL WHERE, mutation is in-place,
      // and `data` is the RETURNING set (row-count source of truth).
      const rows = this.db.tables[this.table] ?? [];
      const updated: Row[] = [];
      for (const row of rows) {
        if (this.matches(row)) {
          for (const patch of this.payload) Object.assign(row, patch);
          updated.push({ ...row });
        }
      }
      return { data: updated, error: null };
    }

    const rows = (this.db.tables[this.table] ?? []).filter((row) => this.matches(row));
    if (this.maybe) return { data: rows[0] ?? null, error: null };
    if (this.singleRow) {
      return rows.length === 1
        ? { data: rows[0], error: null }
        : { data: null, error: { message: "not a single row" } };
    }
    return { data: rows, error: null };
  }
}
