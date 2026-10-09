/**
 * Shared server-side boundary for model providers.
 *
 * `credentialRef` is an opaque reference to encrypted server-side material,
 * never the API key itself. Wallet accounts and model credentials are separate
 * trust domains.
 */
export type ProviderId = "agentshield" | "openai" | "anthropic" | "kimi" | "external";

export type ProviderMode = "managed" | "user_api_key" | "external_agent";

export interface ProviderRequest {
  systemInstruction: string;
  userInput: string;
  model?: string;
  credentialRef?: string;
}

export interface ProviderResponse {
  provider: ProviderId;
  model: string;
  text: string;
  structuredOutput?: unknown;
}

export interface ModelProvider {
  readonly id: ProviderId;
  readonly mode: ProviderMode;
  complete(request: ProviderRequest): Promise<ProviderResponse>;
}

export const providerModes: Record<ProviderId, ProviderMode> = {
  agentshield: "managed",
  openai: "user_api_key",
  anthropic: "user_api_key",
  kimi: "user_api_key",
  external: "external_agent",
};
