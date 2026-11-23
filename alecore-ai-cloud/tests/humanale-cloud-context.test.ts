import test from "node:test";
import assert from "node:assert/strict";

import {
  buildHumanALEContextPacket,
  MAX_CONTEXT_CHARS,
  MAX_CONTEXT_ENTRIES
} from "../src/humanale/context-packet.js";

const records =
  Array.from(
    {
      length:
        10
    },
    (
      _,
      index
    ) => ({
      id:
        "entry-" +
        (index + 1),
      title:
        "Memory " +
        (index + 1),
      content:
        "Isi referensi aman " +
        (index + 1) +
        " untuk HumanALE."
    })
  );

test(
  "HumanALE cloud context uses the Phase 10 packet contract and remains bounded",
  () => {
    const packet =
      buildHumanALEContextPacket(
        records,
        "reasoner",
        "ask"
      );

    assert.ok(
      packet
    );

    assert.equal(
      packet.version,
      1
    );

    assert.equal(
      packet.target,
      "reasoner"
    );

    assert.equal(
      packet.mode,
      "ask"
    );

    assert.equal(
      packet.approved,
      true
    );

    assert.ok(
      packet.count <=
        MAX_CONTEXT_ENTRIES
    );

    assert.equal(
      packet.count,
      packet.entryIds
        .length
    );

    assert.equal(
      packet.chars,
      packet.text.length
    );

    assert.ok(
      packet.chars <=
        MAX_CONTEXT_CHARS
    );
  }
);

test(
  "HumanALE cloud context skips credential-like memory",
  () => {
    const packet =
      buildHumanALEContextPacket(
        [
          {
            id:
              "unsafe",
            title:
              "credential",
            content:
              "api_key=not-a-real-but-credential-shaped-value"
          },
          {
            id:
              "safe",
            title:
              "safe note",
            content:
              "Catatan proyek yang aman."
          }
        ],
        "planner",
        "auto-safe"
      );

    assert.ok(
      packet
    );

    assert.deepEqual(
      packet.entryIds,
      ["safe"]
    );

    assert.equal(
      packet.text.includes(
        "api_key"
      ),
      false
    );
  }
);

test(
  "HumanALE cloud context rejects control-character entries instead of leaking them",
  () => {
    const packet =
      buildHumanALEContextPacket(
        [
          {
            id:
              "bad-control",
            title:
              "bad",
            content:
              "unsafe\u0007memory"
          }
        ],
        "agent",
        "ask"
      );

    assert.equal(
      packet,
      null
    );
  }
);
