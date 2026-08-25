import { isNotFoundError } from "./errors.js";
import type { Agent, HostClient } from "./types.js";

/**
 * Boot probe: try health(), but a 404 is not fatal — we never GET /health
 * on the live path (desktop and env POST-only). listAgents is the connectivity check.
 */
export async function probeAndList(client: HostClient): Promise<Agent[]> {
  try {
    await client.health();
  } catch (err) {
    if (!isNotFoundError(err)) throw err;
  }
  return client.listAgents();
}
