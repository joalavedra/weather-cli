import { execa } from "execa";
import { z } from "zod";

const POLYMARKET_BIN = process.env["POLYMARKET_BIN"] ?? "polymarket";

async function runPolymarket(
  args: string[],
  options: { timeoutMs?: number } = {},
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const result = await execa(POLYMARKET_BIN, ["-o", "json", ...args], {
    timeout: options.timeoutMs ?? 60_000,
    reject: false,
  });
  return {
    exitCode: result.exitCode ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function parseJson<T>(raw: string): T {
  return JSON.parse(raw) as T;
}

const WalletShow = z.object({
  address: z.string().nullish(),
  proxy_address: z.string().nullish(),
  configured: z.boolean(),
  signature_type: z.string().nullish(),
  source: z.string().nullish(),
  config_path: z.string().nullish(),
});

export interface WalletStatus {
  configured: boolean;
  address: string | null;
  proxyAddress: string | null;
  signatureType: string | null;
  usdcBalanceCents: number | null;
  approvalsReady: boolean | null;
  geoblocked: boolean | null;
}

const ApprovalsCheck = z.object({}).loose();

const Geoblock = z.object({}).loose();

export async function getWalletStatus(): Promise<WalletStatus> {
  const show = await runPolymarket(["wallet", "show"]);
  if (show.exitCode !== 0 && !show.stdout.trim()) {
    throw new Error(`polymarket wallet show failed: ${show.stderr}`);
  }
  const parsed = WalletShow.parse(parseJson(show.stdout));
  if (!parsed.configured) {
    return {
      configured: false,
      address: null,
      proxyAddress: null,
      signatureType: parsed.signature_type ?? null,
      usdcBalanceCents: null,
      approvalsReady: null,
      geoblocked: null,
    };
  }

  const [balance, approvals, geo] = await Promise.all([
    runPolymarket(["clob", "balance", "--asset-type", "collateral"]),
    runPolymarket(["approve", "check"]),
    runPolymarket(["clob", "geoblock"]),
  ]);

  let usdcBalanceCents: number | null = null;
  if (balance.exitCode === 0) {
    try {
      const b = parseJson<{ balance?: string | number }>(balance.stdout);
      const n = typeof b.balance === "string" ? Number(b.balance) : b.balance;
      if (typeof n === "number" && Number.isFinite(n)) {
        usdcBalanceCents = Math.round(n * 100);
      }
    } catch {
      // ignore parse errors — surfaced as null
    }
  }

  let approvalsReady: boolean | null = null;
  if (approvals.exitCode === 0) {
    try {
      const a = parseJson<Record<string, unknown>>(approvals.stdout);
      ApprovalsCheck.parse(a);
      approvalsReady = Object.values(a).every(
        (v) => v === true || (typeof v === "object" && v !== null),
      );
    } catch {
      approvalsReady = null;
    }
  }

  let geoblocked: boolean | null = null;
  if (geo.exitCode === 0) {
    try {
      const g = parseJson<{ blocked?: boolean; geoblocked?: boolean }>(
        geo.stdout,
      );
      Geoblock.parse(g);
      geoblocked = Boolean(g.blocked ?? g.geoblocked ?? false);
    } catch {
      geoblocked = null;
    }
  }

  return {
    configured: true,
    address: parsed.address ?? null,
    proxyAddress: parsed.proxy_address ?? null,
    signatureType: parsed.signature_type ?? null,
    usdcBalanceCents,
    approvalsReady,
    geoblocked,
  };
}

export async function createWallet(): Promise<{ address: string }> {
  const result = await runPolymarket(["wallet", "create"]);
  if (result.exitCode !== 0) {
    throw new Error(
      `polymarket wallet create failed: ${result.stderr || result.stdout}`,
    );
  }
  const status = await getWalletStatus();
  if (!status.address) {
    throw new Error("wallet created but address is missing");
  }
  return { address: status.address };
}

export async function runApprovals(): Promise<{ output: string }> {
  const result = await runPolymarket(["approve", "set"], {
    timeoutMs: 5 * 60_000,
  });
  if (result.exitCode !== 0) {
    throw new Error(
      `polymarket approve set failed: ${result.stderr || result.stdout}`,
    );
  }
  return { output: result.stdout };
}

export interface PlacedOrder {
  orderId: string | null;
  status: string | null;
  filled: number | null;
  raw: unknown;
}

export async function placeMarketOrder(args: {
  tokenId: string;
  side: "buy" | "sell";
  amountUsdc: number;
}): Promise<PlacedOrder> {
  if (!Number.isFinite(args.amountUsdc) || args.amountUsdc <= 0) {
    throw new Error(`amountUsdc must be positive, got ${args.amountUsdc}`);
  }
  const result = await runPolymarket([
    "clob",
    "market-order",
    "--token",
    args.tokenId,
    "--side",
    args.side,
    "--amount",
    String(args.amountUsdc),
  ]);
  if (result.exitCode !== 0) {
    throw new Error(
      `polymarket clob market-order failed: ${result.stderr || result.stdout}`,
    );
  }
  const raw = parseJson<Record<string, unknown>>(result.stdout);
  const orderId =
    typeof raw["orderID"] === "string"
      ? (raw["orderID"] as string)
      : typeof raw["order_id"] === "string"
        ? (raw["order_id"] as string)
        : typeof raw["id"] === "string"
          ? (raw["id"] as string)
          : null;
  const status = typeof raw["status"] === "string" ? (raw["status"] as string) : null;
  const filledRaw = raw["takingAmount"] ?? raw["filled"];
  const filled =
    typeof filledRaw === "string"
      ? Number(filledRaw)
      : typeof filledRaw === "number"
        ? filledRaw
        : null;
  return { orderId, status, filled, raw };
}

export async function getPositions(address: string): Promise<unknown[]> {
  const result = await runPolymarket(["data", "positions", address]);
  if (result.exitCode !== 0) {
    throw new Error(
      `polymarket data positions failed: ${result.stderr || result.stdout}`,
    );
  }
  const parsed = parseJson<unknown>(result.stdout);
  return Array.isArray(parsed) ? parsed : [];
}
