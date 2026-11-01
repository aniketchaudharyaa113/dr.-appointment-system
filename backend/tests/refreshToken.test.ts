import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import { app } from "../src/app";
import { startTestEnvironment, stopTestEnvironment } from "./setup";
import pool from "../src/db/pool";

describe("Phase 2 - Task 2.4: Short-lived Access Token & Rotating Refresh Token Auth", () => {
  beforeAll(async () => {
    await startTestEnvironment();
  });

  afterAll(async () => {
    await stopTestEnvironment();
  });

  it("rejects password shorter than 8 characters on signup", async () => {
    const res = await request(app)
      .post("/auth/signup")
      .send({
        email: "shortpass@medibook.test",
        password: "short",
        name: "Short Pass",
      });

    expect(res.status).toBe(400);
    expect(res.body.error || res.body.message).toMatch(/8 characters/);
  });

  it("issues a 15-minute access token and httpOnly refreshToken cookie on login", async () => {
    const email = `refreshtest.${Date.now()}@medibook.test`;
    const password = "ValidPassword123!";

    // 1. Signup
    const signupRes = await request(app)
      .post("/auth/signup")
      .send({ email, password, name: "Refresh User" });

    expect(signupRes.status).toBe(201);
    expect(signupRes.body).toHaveProperty("token");

    // Verify token expiry is 15 minutes (900 seconds)
    const decodedSignup = jwt.decode(signupRes.body.token) as any;
    expect(decodedSignup.exp - decodedSignup.iat).toBe(15 * 60);

    // 2. Login
    const loginRes = await request(app)
      .post("/auth/login")
      .send({ email, password });

    expect(loginRes.status).toBe(200);
    expect(loginRes.body).toHaveProperty("token");

    const decoded = jwt.decode(loginRes.body.token) as any;
    expect(decoded.exp - decoded.iat).toBe(15 * 60);

    // Check Set-Cookie header contains refreshToken and HttpOnly
    const cookies = loginRes.headers["set-cookie"];
    expect(cookies).toBeDefined();
    const refreshCookie = Array.isArray(cookies) ? cookies.find((c) => c.startsWith("refreshToken=")) : cookies;
    expect(refreshCookie).toContain("HttpOnly");
  });

  it("rotates refresh token on /auth/refresh and revokes the old one", async () => {
    const email = `rotatetest.${Date.now()}@medibook.test`;
    const password = "ValidPassword123!";

    await request(app)
      .post("/auth/signup")
      .send({ email, password, name: "Rotate User" });

    const loginRes = await request(app)
      .post("/auth/login")
      .send({ email, password });

    const rawCookies = loginRes.headers["set-cookie"];
    const cookieHeader = Array.isArray(rawCookies) ? rawCookies.join("; ") : rawCookies;

    // 1. Call /auth/refresh with the cookie
    const refreshRes = await request(app)
      .post("/auth/refresh")
      .set("Cookie", cookieHeader);

    expect(refreshRes.status).toBe(200);
    expect(refreshRes.body).toHaveProperty("token");

    // 2. Calling /auth/refresh again with the OLD cookie must fail (token rotation)
    const reuseRes = await request(app)
      .post("/auth/refresh")
      .set("Cookie", cookieHeader);

    expect(reuseRes.status).toBe(401);
    expect(reuseRes.body.error).toContain("revoked");
  });

  it("revokes refresh token and clears cookie on /auth/logout", async () => {
    const email = `logouttest.${Date.now()}@medibook.test`;
    const password = "ValidPassword123!";

    await request(app)
      .post("/auth/signup")
      .send({ email, password, name: "Logout User" });

    const loginRes = await request(app)
      .post("/auth/login")
      .send({ email, password });

    const rawCookies = loginRes.headers["set-cookie"];
    const cookieHeader = Array.isArray(rawCookies) ? rawCookies.join("; ") : rawCookies;

    // Call /auth/logout
    const logoutRes = await request(app)
      .post("/auth/logout")
      .set("Cookie", cookieHeader);

    expect(logoutRes.status).toBe(200);

    // Attempting to refresh after logout must be rejected
    const refreshRes = await request(app)
      .post("/auth/refresh")
      .set("Cookie", cookieHeader);

    expect(refreshRes.status).toBe(401);
  });
});
