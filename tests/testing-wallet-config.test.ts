// The Testing Wallet's config URLs (testing-wallet/FEATURES.md#config-urls).
import { describe, expect, test } from "bun:test";
import { configFromPath, configProblems, configUrl, isTestingWalletUrl } from "../testing-wallet/src/config.ts";

const PLAIN = "https://smart-health-checkin.org/connectathon/testing-wallet/";

describe("Testing Wallet config URLs", () => {
  test("normal settings give the plain URL", () => {
    expect(configUrl(PLAIN, {})).toBe(PLAIN);
    expect(configUrl(PLAIN, { faults: [], status: {}, size: "", patient: "aria" })).toBe(PLAIN);
  });

  test("the documented examples", () => {
    expect(configUrl(PLAIN, { faults: ["bad-signature"] })).toBe(`${PLAIN}eyJmYXVsdHMiOlsiYmFkLXNpZ25hdHVyZSJdfQ/`);
    expect(configUrl(PLAIN, { size: "5m" })).toBe(`${PLAIN}eyJzaXplIjoiNW0ifQ/`);
  });

  test("a config round-trips through the path", () => {
    const config = { faults: ["wrong-origin", "bad-signature"], status: { immunizations: "declined" }, size: "1m", patient: "large" };
    const url = new URL(configUrl(PLAIN, config));
    expect(configFromPath(url.pathname)).toEqual({ config: { faults: ["bad-signature", "wrong-origin"], status: { immunizations: "declined" }, size: "1m", patient: "large" }, segment: url.pathname.split("/").at(-2) });
  });

  test("the plain path is normal", () => {
    expect(configFromPath("/connectathon/testing-wallet/")).toEqual({ config: {} });
    expect(configFromPath("/connectathon/testing-wallet/index.html")).toEqual({ config: {} });
  });

  test("bad configs are errors in words", () => {
    expect(configFromPath("/connectathon/testing-wallet/bm90LWpzb24/")).toMatchObject({ error: expect.stringContaining("JSON") });
    expect(configProblems({ faults: ["nope"], size: "3m", extra: 1 })).toEqual(['unknown field "extra"', 'unknown fault "nope"', "size must be one of 512k, 1m, 2m, 5m"]);
    expect(configProblems([])).toEqual(["the config must be a JSON object"]);
  });

  test("only the plain wallet URL takes options", () => {
    expect(isTestingWalletUrl(PLAIN)).toBe(true);
    expect(isTestingWalletUrl("http://localhost:8794/connectathon/testing-wallet/")).toBe(true);
    expect(isTestingWalletUrl(`${PLAIN}eyJzaXplIjoiNW0ifQ/`)).toBe(false);
    expect(isTestingWalletUrl("https://example.org/wallet/")).toBe(false);
  });
});
