declare module "grok-bot-cli/src/gateway.js" {
  export function hasGatewayAuth(): boolean;
  export function connectGateway(): Promise<{
    gatewayUrl: string;
    gatewayToken: string;
    gatewayHeaders?: Record<string, string>;
  }>;
}

declare module "grok-bot-cli/src/app-session.js" {
  export function hasGrokBotGatewaySession(options?: {
    platform?: NodeJS.Platform;
    home?: string;
  }): boolean;
  export function inspectGrokBotGatewaySession(options?: {
    platform?: NodeJS.Platform;
    home?: string;
  }): {
    present: boolean;
    usable: boolean;
    code?: string;
    error?: string;
  };
}
