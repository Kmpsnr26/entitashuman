import test from "node:test";
import assert from "node:assert/strict";
import { withAleCoreEnvAliases } from "../src/config/env-aliases.js";

test("AleCore environment names map to existing internal Cloud settings", () => {
  const normalized = withAleCoreEnvAliases({
    ALECORE_PORT: "4300",
    PUBLIC_ALECORE_ORIGIN: "https://alecore.example.test",
    ALECORE_SESSION_SECRET: "a".repeat(40)
  });

  assert.equal(normalized.NARA_PORT, "4300");
  assert.equal(normalized.PUBLIC_NARA_ORIGIN, "https://alecore.example.test");
  assert.equal(normalized.NARA_SESSION_SECRET, "a".repeat(40));
});

test("legacy NARA environment names remain supported", () => {
  const normalized = withAleCoreEnvAliases({
    NARA_PORT: "4200",
    PUBLIC_NARA_ORIGIN: "https://legacy.example.test",
    NARA_SESSION_SECRET: "b".repeat(40)
  });

  assert.equal(normalized.NARA_PORT, "4200");
  assert.equal(normalized.PUBLIC_NARA_ORIGIN, "https://legacy.example.test");
  assert.equal(normalized.NARA_SESSION_SECRET, "b".repeat(40));
});

test("AleCore names take precedence without mutating the source", () => {
  const source = {
    ALECORE_PORT: "4300",
    NARA_PORT: "4200",
    PUBLIC_ALECORE_ORIGIN: "https://new.example.test",
    PUBLIC_NARA_ORIGIN: "https://old.example.test",
    ALECORE_SESSION_SECRET: "c".repeat(40),
    NARA_SESSION_SECRET: "d".repeat(40)
  };
  const normalized = withAleCoreEnvAliases(source);

  assert.equal(normalized.NARA_PORT, "4300");
  assert.equal(normalized.PUBLIC_NARA_ORIGIN, "https://new.example.test");
  assert.equal(normalized.NARA_SESSION_SECRET, "c".repeat(40));
  assert.equal(source.NARA_PORT, "4200");
  assert.equal(source.PUBLIC_NARA_ORIGIN, "https://old.example.test");
  assert.equal(source.NARA_SESSION_SECRET, "d".repeat(40));
});
