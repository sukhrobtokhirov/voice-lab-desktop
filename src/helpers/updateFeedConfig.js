const PRODUCTION_UPDATE_FEED = Object.freeze({
  provider: "github",
  owner: "voicelab-uz",
  repo: "desktop",
  private: false,
});

function resolveUpdateFeed({ isPackaged, nodeEnv, owner, repo }) {
  if (isPackaged || nodeEnv !== "development") {
    return { ...PRODUCTION_UPDATE_FEED };
  }
  const safePart = (value, fallback) => {
    const candidate = String(value || "").trim();
    return /^[A-Za-z0-9_.-]{1,100}$/.test(candidate) ? candidate : fallback;
  };
  return {
    ...PRODUCTION_UPDATE_FEED,
    owner: safePart(owner, PRODUCTION_UPDATE_FEED.owner),
    repo: safePart(repo, PRODUCTION_UPDATE_FEED.repo),
  };
}

module.exports = { PRODUCTION_UPDATE_FEED, resolveUpdateFeed };
