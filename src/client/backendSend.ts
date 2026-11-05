/**
 * Send through the Cursor backend (`GrokBotService/SendGrokBotUserMessage`),
 * which is what the desktop app does. The gateway's `/api/sendPrompt` answers
 * 502 "A Sand box session is not permitted on this endpoint" for box tokens.
 * Tiny hand-rolled protobuf: only the fields the app needs are encoded.
 */
import { randomUUID } from "node:crypto";

export const BACKEND_SEND_URL = "https://api2.cursor.sh/aiserver.v1.GrokBotService/SendGrokBotUserMessage";
const CLIENT_VERSION = "0.78.5";

export type CursorAccount = { token: string; teamId?: string };

export type BackendSendInput = {
  agentId: string;
  prompt: string;
  clientNonce: string;
  machineId: string;
  account: CursorAccount;
  fetch?: typeof fetch;
  signal?: AbortSignal;
};

function varint(value: number | bigint): number[] {
  const out: number[] = [];
  let v = BigInt(value);
  while (v >= 0x80n) {
    out.push(Number(v & 0x7fn) | 0x80);
    v >>= 7n;
  }
  out.push(Number(v));
  return out;
}

const str = (field: number, value: string): number[] => {
  const bytes = Buffer.from(value, "utf8");
  return [...varint((field << 3) | 2), ...varint(bytes.length), ...bytes];
};
const num = (field: number, value: number | bigint): number[] => [...varint(field << 3), ...varint(value)];

export function encodeSendRequest(input: {
  agentId: string;
  prompt: string;
  clientNonce: string;
  machineId: string;
  sentAtMs: number;
}): Uint8Array {
  return Uint8Array.from([
    ...str(1, input.agentId),
    ...str(2, input.clientNonce),
    ...str(3, input.prompt),
    ...num(4, input.sentAtMs),
    ...num(13, 1), // source: DESKTOP
    ...str(16, input.machineId),
    ...str(20, "en"),
  ]);
}

/** Returns the refusal message when the backend refused the message, else null. */
export function refusalFromResponse(buf: Uint8Array): string | null {
  let i = 0;
  const next = (): bigint => {
    let v = 0n;
    let shift = 0n;
    let b: number;
    do {
      b = buf[i++] ?? 0;
      v |= BigInt(b & 0x7f) << shift;
      shift += 7n;
    } while (b & 0x80 && i < buf.length);
    return v;
  };
  const fields = new Map<number, number | Uint8Array>();
  while (i < buf.length) {
    const key = next();
    const field = Number(key >> 3n);
    const wire = Number(key & 7n);
    if (wire === 0) fields.set(field, Number(next()));
    else if (wire === 1) i += 8;
    else if (wire === 5) i += 4;
    else if (wire === 2) {
      const len = Number(next());
      fields.set(field, buf.subarray(i, i + len));
      i += len;
    } else break;
  }
  const delivery = fields.get(4);
  const refusal = fields.get(5);
  if (delivery !== 4 && !(refusal instanceof Uint8Array)) return null;
  if (refusal instanceof Uint8Array) {
    const inner = refusalFromFields(refusal);
    return inner || "refused";
  }
  return "refused";
}

function refusalFromFields(buf: Uint8Array): string {
  let i = 0;
  const next = (): number => {
    let v = 0;
    let shift = 0;
    let b: number;
    do {
      b = buf[i++] ?? 0;
      v += (b & 0x7f) * 2 ** shift;
      shift += 7;
    } while (b & 0x80 && i < buf.length);
    return v;
  };
  while (i < buf.length) {
    const key = next();
    const wire = key & 7;
    if (wire === 0) next();
    else if (wire === 2) {
      const len = next();
      const bytes = buf.subarray(i, i + len);
      i += len;
      if (key >> 3 === 2) return Buffer.from(bytes).toString("utf8");
    } else break;
  }
  return "";
}

export async function sendViaBackend(input: BackendSendInput): Promise<{ accepted: boolean; clientNonce: string }> {
  const fetchImpl = input.fetch ?? globalThis.fetch;
  const res = await fetchImpl(BACKEND_SEND_URL, {
    method: "POST",
    headers: {
      "content-type": "application/proto",
      "connect-protocol-version": "1",
      authorization: `Bearer ${input.account.token}`,
      "x-cursor-client-type": "sand",
      "x-cursor-client-version": process.env.SAND_CLIENT_VERSION || CLIENT_VERSION,
      "x-cursor-client-os": process.platform,
      "x-cursor-client-source": "sand-desktop",
      "x-sand-box-namespace": "prod",
      "x-ghost-mode": "true",
      "x-request-id": randomUUID(),
      ...(input.account.teamId ? { "x-cursor-team-id": input.account.teamId } : {}),
    },
    body: encodeSendRequest({ ...input, sentAtMs: Date.now() }),
    ...(input.signal ? { signal: input.signal } : {}),
  });
  const buf = new Uint8Array(await res.arrayBuffer());
  if (!res.ok) {
    throw new Error(`SendGrokBotUserMessage failed: ${res.status} ${Buffer.from(buf).toString("utf8").slice(0, 300)}`);
  }
  const refusal = refusalFromResponse(buf);
  if (refusal != null) throw new Error(`SendGrokBotUserMessage refused: ${refusal}`);
  return { accepted: true, clientNonce: input.clientNonce };
}
