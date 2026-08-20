export const WORKSPACES_ENABLED = import.meta.env.VITE_WORKSPACES_ENABLED === "true";

export const SHARING_ENABLED = import.meta.env.VITE_SHARING_ENABLED === "true";

// Keep the chat implementation available while the VoiceLab AI product surface
// is paused. Both navigation and rendering must honor this flag.
export const VOICELAB_AI_ENABLED = false;
