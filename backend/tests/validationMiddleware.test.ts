import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { app } from "../src/app";
import { startTestEnvironment, stopTestEnvironment } from "./setup";

describe("Phase 2 - Task 2.3: Central Zod Validation Middleware", () => {
  beforeAll(async () => {
    await startTestEnvironment();
  });

  afterAll(async () => {
    await stopTestEnvironment();
  });

  it("rejects login with invalid email format (body validation)", async () => {
    const res = await request(app)
      .post("/auth/login")
      .send({ email: "not-an-email", password: "somepassword" });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("errors");
    expect(res.body.message).toBe("Validation failed");
  });

  it("rejects doctor by id with invalid UUID parameter (param validation)", async () => {
    const res = await request(app).get("/doctors/invalid-non-uuid-id");

    expect(res.status).toBe(400);
    expect(res.body.message).toBe("Validation failed");
    expect(res.body.errors[0].message).toContain("Invalid UUID");
  });

  it("rejects doctor list with negative page number (query validation)", async () => {
    const res = await request(app).get("/doctors?page=-5");

    expect(res.status).toBe(400);
    expect(res.body.message).toBe("Validation failed");
  });
});
