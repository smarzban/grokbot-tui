import { isNotFoundError } from "./errors.js";
import type { Agent, HostClient } from "./types.js";

/**
 * Boot probe: try health(), but a 404 is not fatal — the desktop routed
 * gateway (and some tunnels) have no GET /health. gbot never calls it.
 * listAgents is the real connectivity check.
 */
export async function probeAndList(client: HostClient): Promise<Agent[]> {
  try {
    await client.health();
  } catch (err) {
    if (!isNotFoundError(err)) throw err;
  }
  return client.listAgents();
}
