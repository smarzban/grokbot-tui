import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const banned = ["@adam91holt/grokbot-sdk", "grok-bot-cli"];
const importOfBanned = /(?:from|import|require\()\s*["'](?:@adam91holt\/grokbot-sdk|grok-bot-cli)(?:\/[^"']*)?["']/;

function walk(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "dist" || name === ".git") continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, acc);
    else if (/\.(ts|tsx|js|mjs|cjs)$/.test(name)) acc.push(path);
  }
  return acc;
}

test("package.json has no third-party Grok host libraries", () => {
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  for (const name of banned) {
    assert.equal(pkg.dependencies?.[name], undefined, name);
    assert.equal(pkg.devDependencies?.[name], undefined, name);
  }
});

test("source and tests do not import third-party Grok host libraries", () => {
  const files = [...walk(join(root, "src")), ...walk(join(root, "test"))];
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    assert.equal(importOfBanned.test(text), false, file);
  }
});
