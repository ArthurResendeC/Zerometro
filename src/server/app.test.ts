import { describe, expect, test } from "bun:test";
import { app } from "./app";

describe("GET /api/health", () => {
  test("responde ok", async () => {
    const res = await app.request("/api/health");

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "ok" });
  });
});
