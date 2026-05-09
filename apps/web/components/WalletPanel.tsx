"use client";

import { useEffect, useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import type { WalletState } from "@/components/Workspace";

const POLL_INTERVAL_MS = 10_000;

interface WalletApiPayload {
  configured: boolean;
  address: string | null;
  proxyAddress: string | null;
  signatureType: string | null;
  usdcBalanceUsd: number | null;
  approvalsReady: boolean | null;
  geoblocked: boolean | null;
}

function fmtUsd(n: number | null): string {
  if (n === null) return "—";
  return `$${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

function shortAddr(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

async function fetchWallet(): Promise<WalletApiPayload> {
  const res = await fetch("/api/wallet", { cache: "no-store" });
  if (!res.ok) throw new Error(`wallet status ${res.status}`);
  return (await res.json()) as WalletApiPayload;
}

async function createWallet(): Promise<WalletApiPayload> {
  const res = await fetch("/api/wallet", {
    method: "POST",
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`wallet create ${res.status}`);
  return (await res.json()) as WalletApiPayload;
}

export function WalletPanel({
  onUpdate,
}: {
  onUpdate?: (state: WalletState) => void;
}) {
  const [wallet, setWallet] = useState<WalletApiPayload | null>(null);
  const [phase, setPhase] = useState<"loading" | "creating" | "ready" | "error">(
    "loading",
  );
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const onUpdateRef = useRef(onUpdate);
  onUpdateRef.current = onUpdate;

  useEffect(() => {
    let cancelled = false;

    async function bootstrap() {
      try {
        let status = await fetchWallet();
        if (!status.configured) {
          if (cancelled) return;
          setPhase("creating");
          status = await createWallet();
        }
        if (cancelled) return;
        setWallet(status);
        setPhase("ready");
      } catch (err) {
        if (cancelled) return;
        setPhase("error");
        setErrorMsg(err instanceof Error ? err.message : String(err));
      }
    }

    void bootstrap();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (phase !== "ready") return;
    const id = setInterval(() => {
      void fetchWallet()
        .then((next) => {
          setWallet(next);
        })
        .catch(() => {
          // transient — keep polling
        });
    }, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [phase]);

  useEffect(() => {
    if (!wallet) return;
    onUpdateRef.current?.({
      configured: wallet.configured,
      address: wallet.address,
      usdcBalanceUsd: wallet.usdcBalanceUsd,
      approvalsReady: wallet.approvalsReady,
      geoblocked: wallet.geoblocked,
    });
  }, [wallet]);

  function copyAddress(value: string) {
    void navigator.clipboard.writeText(value).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  if (phase === "loading") {
    return (
      <div className="text-xs text-zinc-500 px-3 py-2 border border-dashed border-zinc-300 rounded">
        Checking wallet…
      </div>
    );
  }
  if (phase === "creating") {
    return (
      <div className="text-xs text-zinc-600 px-3 py-2 bg-white border border-zinc-200 rounded">
        Creating your wallet…
      </div>
    );
  }
  if (phase === "error" || !wallet) {
    return (
      <div className="text-xs text-red-700 px-3 py-2 bg-red-50 border border-red-200 rounded">
        Wallet error: {errorMsg ?? "unknown"}
      </div>
    );
  }
  if (wallet.geoblocked === true) {
    return (
      <div className="text-xs text-amber-700 px-3 py-2 bg-amber-50 border border-amber-200 rounded">
        Polymarket is geoblocked from this location. Trades will fail.
      </div>
    );
  }

  const balance = wallet.usdcBalanceUsd ?? 0;
  const needsFunds = balance < 1;
  const needsApprovals = wallet.approvalsReady === false;
  const showFunding = needsFunds || needsApprovals;
  const fundingAddress =
    wallet.signatureType === "proxy" && wallet.proxyAddress
      ? wallet.proxyAddress
      : wallet.address;
  const fundingLabel =
    wallet.signatureType === "proxy" && wallet.proxyAddress
      ? "Polymarket proxy"
      : "Wallet";

  return (
    <div className="bg-white border border-zinc-200 rounded space-y-3 p-3">
      <div className="space-y-0.5">
        <div className="flex justify-between items-center">
          <span className="text-xs text-zinc-500">{fundingLabel}</span>
          {fundingAddress ? (
            <button
              type="button"
              onClick={() => copyAddress(fundingAddress)}
              className="text-xs font-mono text-zinc-700 hover:text-zinc-900"
              title="Click to copy full address"
            >
              {shortAddr(fundingAddress)} {copied ? "✓" : "⧉"}
            </button>
          ) : (
            <span className="text-xs font-mono text-zinc-400">—</span>
          )}
        </div>
        <div className="flex justify-between text-xs">
          <span className="text-zinc-500">USDC</span>
          <span className="font-mono">{fmtUsd(wallet.usdcBalanceUsd)}</span>
        </div>
        <div className="flex justify-between text-xs">
          <span className="text-zinc-500">Approvals</span>
          <span
            className={
              wallet.approvalsReady === true
                ? "text-emerald-700"
                : wallet.approvalsReady === false
                  ? "text-amber-700"
                  : "text-zinc-500"
            }
          >
            {wallet.approvalsReady === true
              ? "ready"
              : wallet.approvalsReady === false
                ? "needed"
                : "unknown"}
          </span>
        </div>
      </div>

      {showFunding && fundingAddress ? (
        <div className="border-t border-zinc-100 pt-3 space-y-2">
          {needsFunds ? (
            <>
              <div className="text-xs text-zinc-700 font-medium">
                Fund this wallet to start trading
              </div>
              <div className="flex justify-center bg-zinc-50 border border-zinc-200 rounded p-3">
                <QRCodeSVG
                  value={fundingAddress}
                  size={140}
                  level="M"
                  bgColor="#fafafa"
                  fgColor="#18181b"
                />
              </div>
              <button
                type="button"
                onClick={() => copyAddress(fundingAddress)}
                className="w-full text-[11px] font-mono text-zinc-700 break-all bg-zinc-50 border border-zinc-200 rounded px-2 py-1.5 hover:bg-zinc-100 text-left"
                title="Click to copy"
              >
                {fundingAddress} {copied ? "✓" : ""}
              </button>
              <p className="text-[11px] text-zinc-500 leading-relaxed">
                Send USDC on <strong>Polygon</strong> to this address. Also
                send a little MATIC (for gas) to the signer EOA{" "}
                {wallet.address ? (
                  <code className="font-mono">{shortAddr(wallet.address)}</code>
                ) : null}
                . Balance refreshes every few seconds.
              </p>
            </>
          ) : null}
          {needsApprovals && !needsFunds ? (
            <p className="text-[11px] text-zinc-600 leading-relaxed">
              Wallet funded. Ask the broker to <strong>run approvals</strong>{" "}
              before placing a trade.
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
