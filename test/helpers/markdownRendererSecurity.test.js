const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "../..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("AI markdown replaces images with non-network alt text", () => {
  const renderer = read("src/components/ui/MarkdownRenderer.tsx");
  const chatMessage = read("src/components/chat/ChatMessage.tsx");
  const imageRendererStart = renderer.indexOf("img: ({ alt })");
  const imageRendererEnd = renderer.indexOf("code: ({ children })", imageRendererStart);

  assert.notEqual(imageRendererStart, -1, "MarkdownRenderer must override image rendering");
  assert.notEqual(imageRendererEnd, -1, "could not isolate the image renderer override");

  const imageRenderer = renderer.slice(imageRendererStart, imageRendererEnd);
  assert.match(imageRenderer, /\{alt\}/);
  assert.doesNotMatch(imageRenderer, /<img\b|\bsrc=|\bhref=/);
  assert.match(chatMessage, /<MarkdownRenderer\s+content=\{content\}/);
});
