const {
  parse,
  providerConfigValueSchema,
  providerCredentialSaveSchema,
  providerEndpointSaveSchema,
  providerModelListSchema,
  providerReasonSchema,
  providerStreamSchema,
} = require("./providerContracts");

function registerProviderIpc({ handle, providerService }) {
  const configs = {
    "bedrock-region": "bedrockRegion",
    "bedrock-profile": "bedrockProfile",
    "azure-endpoint": "azureEndpoint",
    "azure-deployment": "azureDeployment",
    "azure-api-version": "azureApiVersion",
    "vertex-project": "vertexProject",
    "vertex-location": "vertexLocation",
  };
  for (const [channel, id] of Object.entries(configs)) {
    handle(`get-${channel}`, () => providerService.getConfig(id));
    handle(`save-${channel}`, (_event, value) =>
      providerService.saveConfig(id, parse(providerConfigValueSchema, value))
    );
  }

  handle("provider-credential-status", () => providerService.credentialStatus());
  handle("provider-save-credential", (_event, value) =>
    providerService.saveCredential(parse(providerCredentialSaveSchema, value))
  );
  handle("provider-save-endpoint", (_event, value) =>
    providerService.saveEndpoint(parse(providerEndpointSaveSchema, value))
  );
  handle("provider-list-models", (_event, value) =>
    providerService.listModels(parse(providerModelListSchema, value))
  );
  handle("provider-tinfoil-models", () => providerService.listTinfoilModels());
  handle("provider-reason", (_event, value) =>
    providerService.reason(parse(providerReasonSchema, value))
  );
  handle("provider-stream-start", (event, value) =>
    providerService.startStream(event, parse(providerStreamSchema, value))
  );
  handle("provider-stream-cancel", (event, streamId) => {
    if (typeof streamId !== "string" || streamId.length > 100) {
      throw Object.assign(new Error("Invalid stream id"), { code: "IPC_PAYLOAD_INVALID" });
    }
    return providerService.cancelStream(event, streamId);
  });
}

module.exports = { registerProviderIpc };
