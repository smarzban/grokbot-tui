export type { Agent, ChatTurn, Health, HostClient, HostErrorKind, SendResult } from "./types.js";
export { HostClientError, isHostClientError } from "./types.js";
export { GatewayHostClient, createSdkBot } from "./host.js";
export { MockHostClient } from "./mock.js";
export { openHostClient } from "./factory.js";
export { mapHostError, MISSING_AUTH_MESSAGE, HOST_DOWN_MESSAGE } from "./errors.js";
