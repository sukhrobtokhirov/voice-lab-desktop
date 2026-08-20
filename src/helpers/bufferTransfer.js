function toExactArrayBuffer(buffer) {
  if (!Buffer.isBuffer(buffer) && !(buffer instanceof Uint8Array)) {
    throw new TypeError("Expected a Buffer or Uint8Array");
  }

  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}

module.exports = { toExactArrayBuffer };
