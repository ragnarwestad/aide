// The one checked reader every route that expects an object reads its
// body through: size, syntax and shape, by the same rule for all of them.
import { describe, expect, test } from "bun:test";
import { MAX_BODY } from "../../../src/serve/serve-helpers/config.ts";
import { bodyToObject, readObjectBody } from "../../../src/serve/serve-helpers/http.ts";

const JSON_TYPE = "application/json";
const FORM_TYPE = "application/x-www-form-urlencoded";

const request = (body: string, contentType: string | null = JSON_TYPE, headers: Record<string, string> = {}) =>
  new Request("http://127.0.0.1/x", {
    method: "POST",
    headers: { ...(contentType ? { "content-type": contentType } : {}), ...headers },
    body,
  });

async function refusedWith(res: Awaited<ReturnType<typeof readObjectBody>>): Promise<{ status: number; error: string }> {
  if (!("refusal" in res)) throw new Error(`expected a refusal, got ${JSON.stringify(res.body)}`);
  return { status: res.refusal.status, error: ((await res.refusal.json()) as { error: string }).error };
}

const NOT_AN_OBJECT = { status: 400, error: "the request body is not an object" };

describe("readObjectBody", () => {
  test.each([["3"], ['"x"'], ["true"], ["null"], ["[]"]])(
    "refuses the JSON value %s as not an object (AC-1, AC-4)",
    async (text) => {
      expect(await refusedWith(await readObjectBody(request(text)))).toEqual(NOT_AN_OBJECT);
    },
  );

  test("returns a JSON object as it was sent (AC-1, AC-4)", async () => {
    expect(await readObjectBody(request('{"step":"analyze","checked":true}'))).toEqual({
      body: { step: "analyze", checked: true },
    });
  });

  test("reads an empty body as no fields, whatever the content type (AC-4)", async () => {
    expect(await readObjectBody(request(""))).toEqual({ body: {} });
    expect(await readObjectBody(request("", null))).toEqual({ body: {} });
    expect(await readObjectBody(request("", FORM_TYPE))).toEqual({ body: {} });
  });

  test("refuses a syntax error as a malformed body (AC-4)", async () => {
    expect(await refusedWith(await readObjectBody(request("{not json")))).toEqual({ status: 400, error: "malformed body" });
  });

  test("reads a urlencoded form as bodyToObject does, model.<step> folded (AC-2)", async () => {
    const text = "target=aide%2F81-queue&model.analyze=Opus&model.implement=&steps=analyze";
    expect(await readObjectBody(request(text, FORM_TYPE))).toEqual({
      body: bodyToObject(text, FORM_TYPE) as Record<string, unknown>,
    });
    expect(await readObjectBody(request(text, FORM_TYPE))).toEqual({
      body: { project: "aide", specFolder: "81-queue", model: { analyze: "Opus" }, steps: ["analyze"] },
    });
  });

  test("form: true reads the body as a form whatever the content type says (AC-2)", async () => {
    expect(await readObjectBody(request("pinned=on", JSON_TYPE), { form: true })).toEqual({ body: { pinned: "on" } });
  });

  test("answers 413 over the cap, by the header's claim and by the text (AC-3)", async () => {
    const over = "x".repeat(11);
    expect(await refusedWith(await readObjectBody(request(`"${over}"`), { cap: 10 }))).toEqual({
      status: 413, error: "payload too large",
    });
    const claimed = request("{}", JSON_TYPE, { "content-length": String(MAX_BODY + 1) });
    expect(await refusedWith(await readObjectBody(claimed))).toEqual({ status: 413, error: "payload too large" });
  });

  test("reads a body exactly at the cap (AC-3)", async () => {
    const text = JSON.stringify({ a: "x".repeat(MAX_BODY - 8) });
    expect(text.length).toBe(MAX_BODY);
    expect(await readObjectBody(request(text))).toEqual({ body: { a: "x".repeat(MAX_BODY - 8) } });
  });
});
