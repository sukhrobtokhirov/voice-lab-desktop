const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "../..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

test("desktop typography has stable cross-platform families and scale tokens", () => {
  const css = read("src/index.css");

  assert.match(css, /--font-family-sans:\s*[\s\S]*?"Figtree"/);
  assert.match(css, /-apple-system, BlinkMacSystemFont/);
  assert.match(css, /"Segoe UI Variable Text", "Segoe UI"/);
  assert.match(css, /"Noto Sans",\s*Roboto/);
  assert.match(css, /--font-family-mono:/);

  for (const [token, size, lineHeight] of [
    ["2xs", "0.6875rem", "1rem"],
    ["xs", "0.75rem", "1rem"],
    ["sm", "0.875rem", "1.25rem"],
    ["base", "1rem", "1.5rem"],
    ["lg", "1.125rem", "1.75rem"],
    ["xl", "1.25rem", "1.75rem"],
    ["2xl", "1.5rem", "2rem"],
    ["3xl", "1.875rem", "2.25rem"],
    ["4xl", "2.25rem", "2.5rem"],
  ]) {
    assert.match(css, new RegExp(`--text-${token}: ${size.replace(".", "\\.")}`));
    assert.match(
      css,
      new RegExp(`--text-${token}--line-height: ${lineHeight.replace(".", "\\.")}`)
    );
  }
});

test("desktop components use semantic font-size utilities", () => {
  const sourceFiles = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory() && entry.name !== "dist") visit(target);
      else if (/\.(?:js|jsx|ts|tsx)$/.test(entry.name)) sourceFiles.push(target);
    }
  };
  visit(path.join(root, "src"));

  for (const file of sourceFiles) {
    const source = fs.readFileSync(file, "utf8");
    assert.doesNotMatch(
      source,
      /text-\[(?:\d+(?:\.\d+)?)(?:px|r?em)\]/,
      `${path.relative(root, file)} uses an arbitrary font size`
    );
    assert.doesNotMatch(
      source,
      /(?:leading|tracking)-\[-?\d+(?:\.\d+)?(?:px|r?em)?\]/,
      `${path.relative(root, file)} uses arbitrary typography spacing`
    );
  }
});

test("global text and native controls inherit the normalized desktop foundation", () => {
  const css = read("src/index.css");

  assert.match(css, /body \{[\s\S]*?font-size: var\(--text-sm\)/);
  assert.match(css, /body \{[\s\S]*?line-height: var\(--text-sm--line-height\)/);
  assert.match(css, /button,[\s\S]*?select,[\s\S]*?textarea \{[\s\S]*?font: inherit/);
  assert.match(css, /code,[\s\S]*?pre,[\s\S]*?font-family: var\(--font-family-mono\)/);
  assert.doesNotMatch(css, /h1 \{[\s\S]{0,120}font-size: 2\.5rem/);
});

test("shared controls use readable line-height without locale-hostile tracking", () => {
  const expected = {
    "src/components/ui/button.tsx": /text-sm leading-5 font-medium/,
    "src/components/ui/input.tsx": /text-sm leading-5 text-foreground/,
    "src/components/ui/textarea.tsx": /text-sm leading-5 text-neutral-900/,
    "src/components/ui/label.tsx": /text-sm font-medium leading-5/,
    "src/components/ui/card.tsx": /text-xl font-semibold leading-7/,
    "src/components/ui/dialog.tsx": /text-lg font-semibold leading-6/,
    "src/components/ui/select.tsx": /text-sm leading-5 text-foreground/,
  };
  for (const [file, pattern] of Object.entries(expected)) {
    assert.match(read(file), pattern, file);
  }

  const badge = read("src/components/ui/badge.tsx");
  assert.match(badge, /text-xs leading-4 font-medium tracking-normal/);
  assert.doesNotMatch(badge, /tracking-wide/);
});
