/**
 * One-shot gateway timing diagnostic. Run: npx tsx scripts/gateway-diag.ts
 * Never prints tokens.
 */
import { readConfig, readToken } from "../src/config.js";
import { openHostClient } from "../src/client/factory.js";

async function main(): Promise<void> {
  const config = readConfig();
  const token = readToken();
  const t0 = Date.now();
  try {
    const client = await openHostClient({ config, token, mock: false });
    process.stdout.write(`source: ${client.source}\n`);
    process.stdout.write(`openHostClient: ${Date.now() - t0} ms\n`);

    const t1 = Date.now();
    const roster = await client.listAgents();
    process.stdout.write(`listAgents: ${Date.now() - t1} ms (${roster.length} agents)\n`);

    const bot = roster.find((a) => !a.isGroup) ?? roster[0];
    if (!bot) {
      process.stdout.write("no agents to probe transcript\n");
      return;
    }
    process.stdout.write(`probe agent: ${bot.name} (${bot.id.slice(0, 8)}…)\n`);

    const t2 = Date.now();
    const turns = await client.getTranscript(bot.id, 50);
    process.stdout.write(`getTranscript(50, full hydrate): ${Date.now() - t2} ms (${turns.length} turns)\n`);

    const t2b = Date.now();
    const full = await client.getTranscript(bot.id, 500);
    const fullMs = Date.now() - t2b;
    const images = full.reduce((n, t) => n + (t.images?.length ?? 0), 0);
    process.stdout.write(
      `getTranscript(500, full hydrate): ${fullMs} ms (${full.length} turns, ${images} images)\n`,
    );

    const images50 = turns.reduce((n, t) => n + (t.images?.length ?? 0), 0);
    process.stdout.write(`images in 50-tail: ${images50}\n`);

    const tPoll = Date.now();
    await client.getTranscript(bot.id, 100, { hydrate: false });
    process.stdout.write(`transcript poll only (100, no hydrate): ${Date.now() - tPoll} ms\n`);

    const tPollOld = Date.now();
    await client.getTranscript(bot.id, 500);
    await client.listAgents();
    process.stdout.write(`old poll tick (500 hydrate + listAgents): ${Date.now() - tPollOld} ms\n`);

    const t3 = Date.now();
    await client.listAgents();
    process.stdout.write(`listAgents (2nd): ${Date.now() - t3} ms\n`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stdout.write(`ERROR: ${message}\n`);
    process.exitCode = 1;
  }
}

void main();
