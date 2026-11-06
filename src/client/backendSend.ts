/**
 * Cursor backend send. The gateway `/api/sendPrompt` rejects a box session.
 * The desktop app posts this RPC with the Cursor access token instead.
 */
import { randomUUID } from "node:crypto";
import type { CursorAccount } from "./types.js";
import { GatewayHttpError } from "./http.js";

export const BACKEND_SEND_URL =
  "https://api2.cursor.sh/aiserver.v1.GrokBotService/SendGrokBotUserMessage";

/** Stable Grok Bot build whose bundled proto defines this RPC. */
export const DEFAULT_BACKEND_CLIENT_VERSION = "0.79.2";

const SOURCE_DESKTOP = 1;
const SEND_SOURCE_CHAT = 1;
const DELIVERY_UNSPECIFIED = 0;
const DELIVERY_ACCEPTED_BOX = 1;
const DELIVERY_ACCEPTED_TEMPORAL = 2;
const DELIVERY_DUPLICATE = 3;
const DELIVERY_REFUSED = 4;

export type BackendSendInput = {
  agentId: string;
  prompt: string;
  clientNonce: string;
  machineId: string;
  account: CursorAccount;
  clientVersion?: string;
  fetch?: typeof fetch;
  signal?: AbortSignal;
};

type ProtoField =
  | { kind: "varint"; value: bigint }
  | { kind: "bytes"; value: Uint8Array };

function varint(value: number | bigint): Buffer {
  const out: number[] = [];
  let v = BigInt(value);
  while (v >= 0x80n) {
    out.push(Number(v & 0x7fn) | 0x80);
    v >>= 7n;
  }
  out.push(Number(v));
  return Buffer.from(out);
}

function tag(field: number, wire: number): Buffer {
  return varint((field << 3) | wire);
}

function strField(field: number, value: string): Buffer {
  const data = Buffer.from(value, "utf8");
  return Buffer.concat([tag(field, 2), varint(data.length), data]);
}

function numField(field: number, value: number | bigint): Buffer {
  return Buffer.concat([tag(field, 0), varint(value)]);
}

export function encodeSendRequest(input: {
  agentId: string;
  prompt: string;
  clientNonce: string;
  machineId: string;
  sentAtMs: number;
}): Uint8Array {
  // Field 15 (session_id) stays unset. The app sends it empty. A random id
  // comes back as agent not found.
  return Buffer.concat([
    strField(1, input.agentId),
    strField(2, input.clientNonce),
    strField(3, input.prompt),
    numField(4, input.sentAtMs),
    numField(13, SOURCE_DESKTOP),
    strField(16, input.machineId),
    strField(20, "en"),
    numField(21, SEND_SOURCE_CHAT),
  ]);
}

function readFields(buf: Uint8Array): Map<number, ProtoField> {
  const fields = new Map<number, ProtoField>();
  let i = 0;
  const next = (): bigint => {
    let v = 0n;
    let shift = 0n;
    let b = 0;
    do {
      if (i >= buf.length || shift > 63) {
        throw new Error("truncated");
      }
      b = buf[i++] ?? 0;
      v |= BigInt(b & 0x7f) << shift;
      shift += 7n;
    } while (b & 0x80);
    return v;
  };
  while (i < buf.length) {
    const key = next();
    const field = Number(key >> 3n);
    const wire = Number(key & 7n);
    if (wire === 0) {
      fields.set(field, { kind: "varint", value: next() });
    } else if (wire === 2) {
      const len = Number(next());
      if (!Number.isInteger(len) || len < 0 || i + len > buf.length) {
        throw new Error("truncated");
      }
      fields.set(field, { kind: "bytes", value: buf.subarray(i, i + len) });
      i += len;
    } else if (wire === 1) {
      i += 8;
    } else if (wire === 5) {
      i += 4;
    } else {
      throw new Error("bad wire");
    }
  }
  return fields;
}

function refusalMessage(bytes: Uint8Array | undefined): string {
  if (!bytes || bytes.length === 0) return "refused";
  try {
    const text = readFields(bytes).get(2);
    if (text?.kind === "bytes" && text.value.length > 0) {
      return Buffer.from(text.value).toString("utf8");
    }
  } catch {
    return "refused";
  }
  return "refused";
}

type SendDelivery = "unspecified" | "accepted" | "refused" | "other";

function sendDelivery(value: number): SendDelivery {
  if (
    value === DELIVERY_ACCEPTED_BOX ||
    value === DELIVERY_ACCEPTED_TEMPORAL ||
    value === DELIVERY_DUPLICATE
  ) {
    return "accepted";
  }
  if (value === DELIVERY_REFUSED) return "refused";
  if (value === DELIVERY_UNSPECIFIED) return "unspecified";
  return "other";
}

export function assertSendAccepted(buf: Uint8Array): void {
  let fields: Map<number, ProtoField>;
  try {
    fields = readFields(buf);
  } catch {
    throw new Error("SendGrokBotUserMessage returned an unreadable response.");
  }
  const deliveryField = fields.get(4);
  const delivery = deliveryField?.kind === "varint" ? Number(deliveryField.value) : DELIVERY_UNSPECIFIED;
  const refusal = fields.get(5);
  const kind = sendDelivery(delivery);
  switch (kind) {
    case "accepted":
      return;
    case "refused":
      throw new Error(
        `SendGrokBotUserMessage refused: ${refusalMessage(refusal?.kind === "bytes" ? refusal.value : undefined)}`,
      );
    case "unspecified":
      throw new Error("SendGrokBotUserMessage returned an unspecified delivery.");
    case "other":
      throw new Error(`SendGrokBotUserMessage returned delivery ${delivery}.`);
    default: {
      const unexpected: never = kind;
      throw new Error(`SendGrokBotUserMessage returned delivery ${String(unexpected)}.`);
    }
  }
}

function errorDetail(buf: Uint8Array): string {
  const text = Buffer.from(buf).toString("utf8");
  const code = text.match(/"error":"([A-Z0-9_]+)"/);
  if (code?.[1]) return code[1];
  return text.slice(0, 300);
}

export async function sendViaBackend(
  input: BackendSendInput,
): Promise<{ accepted: true; clientNonce: string }> {
  const fetchImpl = input.fetch ?? globalThis.fetch;
  const version = input.clientVersion?.trim() || DEFAULT_BACKEND_CLIENT_VERSION;
  const res = await fetchImpl(BACKEND_SEND_URL, {
    method: "POST",
    redirect: "error",
    headers: {
      "content-type": "application/proto",
      "connect-protocol-version": "1",
      authorization: `Bearer ${input.account.token}`,
      "x-cursor-client-type": "sand",
      "x-cursor-client-version": version,
      "x-cursor-client-os": process.platform,
      "x-cursor-client-source": "sand-desktop",
      "x-sand-box-namespace": "prod",
      "x-ghost-mode": "true",
      "x-request-id": randomUUID(),
      ...(input.account.teamId ? { "x-cursor-team-id": input.account.teamId } : {}),
    },
    body: encodeSendRequest({
      agentId: input.agentId,
      prompt: input.prompt,
      clientNonce: input.clientNonce,
      machineId: input.machineId,
      sentAtMs: Date.now(),
    }),
    ...(input.signal ? { signal: input.signal } : {}),
  });
  const buf = new Uint8Array(await res.arrayBuffer());
  if (!res.ok) {
    throw new GatewayHttpError(`SendGrokBotUserMessage failed: ${res.status} ${errorDetail(buf)}`, {
      status: res.status,
      method: "SendGrokBotUserMessage",
    });
  }
  assertSendAccepted(buf);
  return { accepted: true, clientNonce: input.clientNonce };
}
