const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const {
  createPinnedFetch,
  isPublicAddress,
  isSafeLanAddress,
  resolveApprovedEndpoint,
} = require("../../src/helpers/providerNetworkPolicy");
const { ProviderService } = require("../../src/helpers/providerService");

const lookup = (records) => async () => records;

test("remote custom providers reject private, loopback, link-local, and metadata addresses", async () => {
  for (const address of [
    "127.0.0.1",
    "10.0.0.1",
    "172.16.0.1",
    "192.168.1.2",
    "169.254.1.1",
    "169.254.169.254",
    "100.100.100.200",
    "::1",
    "fc00::1",
    "fe80::1",
  ]) {
    await assert.rejects(
      resolveApprovedEndpoint(
        "https://provider.example/v1",
        "remote",
        lookup([{ address, family: address.includes(":") ? 6 : 4 }])
      ),
      { code: "PROVIDER_ENDPOINT_FORBIDDEN" }
    );
  }
});

test("remote custom providers reject mixed DNS answers and allow only public addresses", async () => {
  await assert.rejects(
    resolveApprovedEndpoint(
      "https://provider.example/v1",
      "remote",
      lookup([
        { address: "8.8.8.8", family: 4 },
        { address: "127.0.0.1", family: 4 },
      ])
    ),
    { code: "PROVIDER_ENDPOINT_FORBIDDEN" }
  );
  const result = await resolveApprovedEndpoint(
    "https://provider.example/v1",
    "remote",
    lookup([{ address: "8.8.8.8", family: 4 }])
  );
  assert.equal(result.records[0].address, "8.8.8.8");
  assert.equal(isPublicAddress("8.8.8.8"), true);
});

test("LAN providers are credentialless and limited to explicit local networks", async () => {
  assert.equal(isSafeLanAddress("127.0.0.1"), true);
  assert.equal(isSafeLanAddress("192.168.1.50"), true);
  assert.equal(isSafeLanAddress("10.20.30.40"), true);
  assert.equal(isSafeLanAddress("169.254.169.254"), false);
  assert.equal(isSafeLanAddress("8.8.8.8"), false);

  await assert.rejects(
    resolveApprovedEndpoint(
      "http://lan.example/v1",
      "lan",
      lookup([{ address: "8.8.8.8", family: 4 }])
    ),
    { code: "PROVIDER_ENDPOINT_FORBIDDEN" }
  );
});

test("pinned provider transport rejects redirects and strips LAN credentials", async () => {
  let authorization;
  const server = http.createServer((request, response) => {
    authorization = request.headers.authorization;
    response.writeHead(302, { location: "http://127.0.0.1/private" });
    response.end();
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const { port } = server.address();
    const pinnedFetch = createPinnedFetch(`http://127.0.0.1:${port}/v1`, "lan");
    await assert.rejects(
      pinnedFetch(`http://127.0.0.1:${port}/v1/models`, {
        headers: { Authorization: "Bearer must-not-leak" },
      }),
      /redirects are not allowed/
    );
    assert.equal(authorization, undefined);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("custom credentials are bound to the main-process approved endpoint", async () => {
  const calls = [];
  const service = new ProviderService(
    {
      getCleanupCustomKey: () => "bound-secret",
      getCustomProviderEndpoint: () => "https://approved.example/v1",
    },
    {
      createPinnedFetch: (endpoint, mode) => async (url, init) => {
        calls.push({ endpoint, mode, url, authorization: init.headers.Authorization });
        return new Response(JSON.stringify({ data: [{ id: "approved-model" }] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    }
  );

  const result = await service.listModels({ provider: "custom" });
  assert.deepEqual(result.models.map((model) => model.id), ["approved-model"]);
  assert.deepEqual(calls, [
    {
      endpoint: "https://approved.example/v1",
      mode: "remote",
      url: "https://approved.example/v1/models",
      authorization: "Bearer bound-secret",
    },
  ]);
});
