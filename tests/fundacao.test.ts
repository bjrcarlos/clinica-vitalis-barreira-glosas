import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function readWranglerConfig(): Record<string, unknown> {
  const raw = readFileSync(resolve(__dirname, "../wrangler.jsonc"), "utf-8");
  const withoutComments = raw.replace(/^\s*\/\/.*$/gm, "");
  return JSON.parse(withoutComments) as Record<string, unknown>;
}

describe("fundação do scaffold", () => {
  const config = readWranglerConfig();

  it("declara o binding D1 (DB)", () => {
    const d1 = config.d1_databases as Array<Record<string, unknown>>;
    expect(d1?.[0]?.binding).toBe("DB");
    expect(d1?.[0]?.database_name).toBe("vitalis-glosas");
  });

  it("declara o binding R2 (EVIDENCE)", () => {
    const r2 = config.r2_buckets as Array<Record<string, unknown>>;
    expect(r2?.[0]?.binding).toBe("EVIDENCE");
    expect(r2?.[0]?.bucket_name).toBe("vitalis-evidencias");
  });

  it("declara o binding Workers AI (AI)", () => {
    const ai = config.ai as Record<string, unknown>;
    expect(ai?.binding).toBe("AI");
  });

  it("declara o binding de assets (ASSETS) servindo dist/client", () => {
    const assets = config.assets as Record<string, unknown>;
    expect(assets?.binding).toBe("ASSETS");
    expect(assets?.directory).toBe("./dist/client");
  });
});
