const test = require("node:test");
const assert = require("node:assert/strict");
const { toExactArrayBuffer } = require("../../src/helpers/bufferTransfer");

test("IPC buffer transfer exposes only the requested Buffer view", () => {
  const backing = Buffer.alloc(32, 0x41);
  const view = backing.subarray(9, 14);
  view.set([1, 2, 3, 4, 5]);

  const transferred = toExactArrayBuffer(view);
  assert.equal(transferred.byteLength, 5);
  assert.deepEqual(Array.from(new Uint8Array(transferred)), [1, 2, 3, 4, 5]);
});

test("IPC buffer transfer rejects unsupported values", () => {
  assert.throws(() => toExactArrayBuffer("secret"), TypeError);
});
