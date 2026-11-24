export function selectDefaultConversationProvider({
  desktop = false,
  savedProvider = '',
  providers = []
} = {}) {
  if (!desktop) return 'chatgpt';
  const allowedProviders = Array.isArray(providers) ? providers : [];
  return allowedProviders.includes(savedProvider) ? savedProvider : 'alecore-local';
}
