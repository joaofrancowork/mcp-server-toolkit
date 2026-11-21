import { beforeAll, describe, expect, it } from "vitest";
import { connect, makeRoot, resourceText, text } from "./helpers.js";

let root: string;
let session: Awaited<ReturnType<typeof connect>>;

beforeAll(async () => {
  root = makeRoot();
  session = await connect({ root, enableFetch: false });
});

describe("protocol surface", () => {
  it("lists tools with read-only annotations and input schemas", async () => {
    const { tools } = await session.client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual([
      "csv_profile",
      "json_query",
      "sqlite_query",
      "sqlite_schema",
      "text_diff",
    ]);
    for (const tool of tools) {
      expect(tool.annotations?.readOnlyHint).toBe(true);
      expect(tool.inputSchema.type).toBe("object");
    }
  });

  it("lists data files as a resource and reads a file via the template", async () => {
    const listing = await session.client.readResource({ uri: "toolkit://files" });
    const files = JSON.parse(resourceText(listing.contents[0])) as { path: string }[];
    expect(files.map((f) => f.path).sort()).toEqual([
      "escape.csv",
      "nested/notes.md",
      "orders.csv",
      "shop.db",
    ]);
    const note = await session.client.readResource({ uri: "toolkit://file/nested/notes.md" });
    expect(resourceText(note.contents[0])).toContain("hello");
  });

  it("refuses to read through a symlink that escapes the root", async () => {
    await expect(session.client.readResource({ uri: "toolkit://file/escape.csv" })).rejects.toThrow(
      /outside the allowed directory/,
    );
  });

  it("serves the explore_dataset prompt", async () => {
    const prompt = await session.client.getPrompt({
      name: "explore_dataset",
      arguments: { path: "orders.csv", question: "Which city pays best?" },
    });
    const content = prompt.messages[0]?.content;
    expect(content?.type === "text" && content.text).toContain("csv_profile");
  });
});

describe("sqlite tools", () => {
  it("describes the schema", async () => {
    const result = await session.call("sqlite_schema", { database: "shop.db" });
    expect(text(result)).toContain("customers (3 rows): id INTEGER, name TEXT, city TEXT");
  });

  it("runs read-only queries and returns structured rows", async () => {
    const result = await session.call("sqlite_query", {
      database: "shop.db",
      sql: "SELECT city, COUNT(*) AS n FROM customers GROUP BY city ORDER BY n DESC;",
    });
    expect(result.isError).toBeFalsy();
    expect(text(result)).toContain("| Lisbon | 2 |");
    expect(result.structuredContent).toMatchObject({ columns: ["city", "n"] });
  });

  it.each([
    ["DELETE FROM customers", "read-only"],
    ["SELECT 1; DROP TABLE customers", "single statement"],
    ["WITH x AS (SELECT 1) DELETE FROM customers", "delete"],
    ["SELECT * FROM customers WHERE name = 'drop' AND 1 = 1", null],
    ["ATTACH DATABASE '/tmp/x.db' AS x", "read-only"],
  ])("guards %s", async (sql, expected) => {
    const result = await session.call("sqlite_query", { database: "shop.db", sql });
    if (expected === null) expect(result.isError).toBeFalsy();
    else expect(text(result).toLowerCase()).toContain(expected);
  });

  it("reports SQL errors and sandbox violations as tool errors", async () => {
    const bad = await session.call("sqlite_query", {
      database: "shop.db",
      sql: "SELECT * FROM nope",
    });
    expect(bad.isError).toBe(true);
    expect(text(bad)).toContain("no such table");
    const traversal = await session.call("sqlite_schema", { database: "../../etc/passwd" });
    expect(traversal.isError).toBe(true);
    const wrongType = await session.call("sqlite_schema", { database: "orders.csv" });
    expect(text(wrongType)).toContain("Expected one of");
  });
});

describe("csv_profile", () => {
  it("infers types, nulls, ranges and top values", async () => {
    const result = await session.call("csv_profile", { path: "orders.csv" });
    const out = text(result);
    expect(out).toContain("orders.csv: 3 rows, 5 columns");
    expect(out).toContain("amount: number · 1 null · 2 unique · range 10.5..30 · mean 20.25");
    expect(out).toContain("paid: boolean");
    expect(out).toContain("date: date");
    expect(out).toContain("city: text · 0 null · 2 unique · top Lisbon (2), Porto (1)");
  });

  it("blocks symlink escapes and missing files", async () => {
    expect(text(await session.call("csv_profile", { path: "escape.csv" }))).toContain(
      "Access denied",
    );
    expect(text(await session.call("csv_profile", { path: "missing.csv" }))).toContain("not found");
    expect(text(await session.call("csv_profile", { path: "nested" }))).toMatch(
      /Not a file|Expected/,
    );
  });
});

describe("text tools", () => {
  it("queries JSON with JMESPath", async () => {
    const json = JSON.stringify({
      items: [
        { name: "a", price: 5 },
        { name: "b", price: 20 },
      ],
    });
    const result = await session.call("json_query", {
      json,
      expression: "items[?price > `10`].name",
    });
    expect(result.structuredContent).toEqual({ result: ["b"] });
    expect(text(await session.call("json_query", { json: "{oops", expression: "a" }))).toContain(
      "Invalid JSON",
    );
    expect(text(await session.call("json_query", { json, expression: "items[?" }))).toContain(
      "Invalid JMESPath",
    );
  });

  it("diffs texts", async () => {
    const result = await session.call("text_diff", { before: "a b c\n", after: "a x c\n" });
    expect(text(result)).toContain("-a b c");
    expect(result.structuredContent).toMatchObject({ wordsAdded: 1, wordsRemoved: 1 });
    expect(text(await session.call("text_diff", { before: "same", after: "same" }))).toContain(
      "identical",
    );
  });
});
