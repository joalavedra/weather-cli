import { createWallet, getWalletStatus } from "@weather/core";

export const runtime = "nodejs";

interface WalletPayload {
  configured: boolean;
  address: string | null;
  proxyAddress: string | null;
  signatureType: string | null;
  usdcBalanceUsd: number | null;
  approvalsReady: boolean | null;
  geoblocked: boolean | null;
}

function toPayload(s: Awaited<ReturnType<typeof getWalletStatus>>): WalletPayload {
  return {
    configured: s.configured,
    address: s.address,
    proxyAddress: s.proxyAddress,
    signatureType: s.signatureType,
    usdcBalanceUsd:
      s.usdcBalanceCents !== null ? s.usdcBalanceCents / 100 : null,
    approvalsReady: s.approvalsReady,
    geoblocked: s.geoblocked,
  };
}

export async function GET(): Promise<Response> {
  try {
    const status = await getWalletStatus();
    return Response.json(toPayload(status));
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}

export async function POST(): Promise<Response> {
  try {
    const existing = await getWalletStatus();
    if (existing.configured) {
      return Response.json(toPayload(existing));
    }
    await createWallet();
    const fresh = await getWalletStatus();
    return Response.json(toPayload(fresh));
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
