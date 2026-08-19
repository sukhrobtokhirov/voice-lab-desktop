const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const repositoryRoot = path.resolve(__dirname, "../..");
const desktopAuthManagerPath = path.join(repositoryRoot, "src/helpers/desktopAuthManager.js");
const executableExtensions = new Set([".js", ".jsx", ".ts", ".tsx"]);
const forbiddenDesktopSessionRoutes = ["/api/v2/auth/login", "/api/v2/auth/refresh"];

function executableSourceFiles(directory) {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (["dist", "node_modules"].includes(entry.name)) continue;
    const location = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...executableSourceFiles(location));
    } else if (executableExtensions.has(path.extname(entry.name))) {
      files.push(location);
    }
  }
  return files;
}

test("desktop executable sources never reference generic login or refresh routes", () => {
  const sourceFiles = [
    path.join(repositoryRoot, "main.js"),
    path.join(repositoryRoot, "preload.js"),
    ...executableSourceFiles(path.join(repositoryRoot, "preloads")),
    ...executableSourceFiles(path.join(repositoryRoot, "src")),
  ];

  for (const sourceFile of sourceFiles) {
    const source = fs.readFileSync(sourceFile, "utf8");
    for (const forbiddenRoute of forbiddenDesktopSessionRoutes) {
      assert.equal(
        source.includes(forbiddenRoute),
        false,
        `${path.relative(repositoryRoot, sourceFile)} references forbidden desktop auth route ${forbiddenRoute}`
      );
    }
  }
});

test("every DesktopAuthManager POST uses a dedicated desktop auth endpoint", () => {
  const source = fs.readFileSync(desktopAuthManagerPath, "utf8");
  const postRequestPattern = /_request\(\s*["']([^"']+)["']\s*,\s*\{\s*method:\s*["']POST["']/g;
  const postRoutes = [...source.matchAll(postRequestPattern)].map((match) => match[1]);

  assert.deepEqual([...new Set(postRoutes)].sort(), [
    "/api/v2/auth/desktop/authorizations",
    "/api/v2/auth/desktop/logout",
    "/api/v2/auth/desktop/token",
  ]);
  for (const route of postRoutes) {
    assert.match(route, /^\/api\/v2\/auth\/desktop\//);
    assert.equal(forbiddenDesktopSessionRoutes.includes(route), false);
  }
});
