import test from "node:test";
import assert from "node:assert/strict";

import {
  isTrustedRequestOrigin
} from "../src/security/origin.js";

const expected =
  "https://nara.example.test";

test(
  "origin enforcement allows exact same origin and same-origin referer",
  () => {
    assert.equal(
      isTrustedRequestOrigin(
        {
          origin:
            expected,
          secFetchSite:
            "same-origin"
        },
        expected,
        true
      ),
      true
    );

    assert.equal(
      isTrustedRequestOrigin(
        {
          referer:
            expected +
            "/workspace"
        },
        expected,
        true
      ),
      true
    );
  }
);

test(
  "origin enforcement rejects cross-site, sibling origin and missing evidence",
  () => {
    assert.equal(
      isTrustedRequestOrigin(
        {
          origin:
            expected,
          secFetchSite:
            "cross-site"
        },
        expected,
        true
      ),
      false
    );

    assert.equal(
      isTrustedRequestOrigin(
        {
          origin:
            "https://other.example.test"
        },
        expected,
        true
      ),
      false
    );

    assert.equal(
      isTrustedRequestOrigin(
        {},
        expected,
        true
      ),
      false
    );

    assert.equal(
      isTrustedRequestOrigin(
        {
          referer:
            "not a url"
        },
        expected,
        true
      ),
      false
    );
  }
);

test(
  "development mode does not enforce browser-origin evidence",
  () => {
    assert.equal(
      isTrustedRequestOrigin(
        {},
        expected,
        false
      ),
      true
    );
  }
);

test("development permits missing origin evidence but rejects explicit hostile evidence", () => {
  assert.equal(isTrustedRequestOrigin({origin: "https://attacker.example.invalid"}, expected, false), false);
  assert.equal(isTrustedRequestOrigin({origin: expected, secFetchSite: "cross-site"}, expected, false), false);
  assert.equal(isTrustedRequestOrigin({referer: "https://attacker.example.invalid/path"}, expected, false), false);
  assert.equal(isTrustedRequestOrigin({origin: expected}, expected, false), true);
});
