const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const markdownMirror = require("../../src/helpers/markdownMirror");

function createFixture() {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "voicelab-mirror-security-"));
  const mirrorRoot = path.join(fixtureRoot, "mirror");
  const outsideRoot = path.join(fixtureRoot, "outside");
  fs.mkdirSync(outsideRoot);
  fs.writeFileSync(path.join(outsideRoot, "keep.txt"), "keep");
  markdownMirror.init(mirrorRoot);
  return { fixtureRoot, mirrorRoot, outsideRoot };
}

test("markdown mirror rejects traversal, absolute, separator, and control folder names", () => {
  for (const name of [
    "..",
    ".",
    "../outside",
    "..\\outside",
    "/tmp/outside",
    "C:\\outside",
    "nested/folder",
    "nested\\folder",
    "bad\u0000name",
    "\nname",
  ]) {
    assert.throws(() => markdownMirror.assertSafeFolderName(name), /Invalid markdown mirror/);
  }
  assert.equal(markdownMirror.assertSafeFolderName("Customer notes"), "Customer notes");
});

test("recursive delete and writes cannot escape the canonical mirror root", (t) => {
  const { fixtureRoot, mirrorRoot, outsideRoot } = createFixture();
  t.after(() => fs.rmSync(fixtureRoot, { recursive: true, force: true }));

  markdownMirror.deleteFolder("../outside");
  markdownMirror.writeNote({ id: "1", title: "Escape", content: "owned" }, "../outside");

  assert.equal(fs.readFileSync(path.join(outsideRoot, "keep.txt"), "utf8"), "keep");
  assert.equal(fs.existsSync(path.join(outsideRoot, "1-escape.md")), false);
  assert.equal(fs.existsSync(mirrorRoot), true);
});

test("symlink folders are rejected for writes, renames, and recursive deletion", (t) => {
  const { fixtureRoot, mirrorRoot, outsideRoot } = createFixture();
  t.after(() => fs.rmSync(fixtureRoot, { recursive: true, force: true }));
  fs.symlinkSync(outsideRoot, path.join(mirrorRoot, "escape"), "dir");

  markdownMirror.writeNote({ id: "2", title: "Escape", content: "owned" }, "escape");
  markdownMirror.renameFolder("escape", "renamed");
  markdownMirror.deleteFolder("escape");

  assert.equal(fs.existsSync(path.join(mirrorRoot, "escape")), true);
  assert.equal(fs.existsSync(path.join(mirrorRoot, "renamed")), false);
  assert.equal(fs.readFileSync(path.join(outsideRoot, "keep.txt"), "utf8"), "keep");
  assert.equal(fs.existsSync(path.join(outsideRoot, "2-escape.md")), false);
});

test("folder create and rename IPC validate names before database mutation", () => {
  const source = fs.readFileSync(
    path.resolve(__dirname, "../../src/helpers/ipcHandlers.js"),
    "utf8"
  );
  assert.match(
    source,
    /db-create-folder[\s\S]{0,180}assertSafeFolderName\(name\)[\s\S]{0,180}createFolder\(name\)/
  );
  assert.match(
    source,
    /db-rename-folder[\s\S]{0,180}assertSafeFolderName\(name\)[\s\S]{0,180}renameFolder\(id, name\)/
  );
});
