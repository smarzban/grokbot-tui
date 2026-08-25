export type { Agent, AgentMember, ChatTurn, Health, HostClient, HostErrorKind, SendResult } from "./types.js";
export { HostClientError, isHostClientError } from "./types.js";
export { GatewayHostClient, createSdkBot } from "./host.js";
export { DesktopHostClient } from "./desktop.js";
export { MockHostClient } from "./mock.js";
export { openHostClient } from "./factory.js";
export { probeAndList } from "./boot.js";
export { mapHostError, MISSING_AUTH_MESSAGE, HOST_DOWN_MESSAGE, isNotFoundError } from "./errors.js";
