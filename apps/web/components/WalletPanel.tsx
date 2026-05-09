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
  const res = await fetch("/api/wallet", { method: "POST", cache: "no-store" });
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
  const [qrOpen, setQrOpen] = useState(true);
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
        .then((next) => setWallet(next))
        .catch(() => {});
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
      <div className="t-panel">
        <div className="t-panel-label">
          <span>Wallet</span>
          <span className="t-pill warn">checking</span>
        </div>
      </div>
    );
  }
  if (phase === "creating") {
    return (
      <div className="t-panel">
        <div className="t-panel-label">
          <span>Wallet</span>
          <span className="t-pill warn">creating</span>
        </div>
      </div>
    );
  }
  if (phase === "error" || !wallet) {
    return (
      <div className="t-panel" style={{ borderColor: "var(--red)" }}>
        <div className="t-panel-label" style={{ marginBottom: 6 }}>
          <span>Wallet</span>
          <span className="t-pill err">error</span>
        </div>
        <div className="text-[10.5px] text-[var(--text-dim)] break-all">
          {errorMsg ?? "unknown"}
        </div>
      </div>
    );
  }
  if (wallet.geoblocked === true) {
    return (
      <div className="t-panel" style={{ borderColor: "var(--amber-dim)" }}>
        <div className="t-panel-label" style={{ marginBottom: 6 }}>
          <span>Wallet</span>
          <span className="t-pill warn">geoblocked</span>
        </div>
        <div className="text-[10.5px] text-[var(--text-dim)]">
          Polymarket is geoblocked from this location. Trades will fail.
        </div>
      </div>
    );
  }

  const balance = wallet.usdcBalanceUsd ?? 0;
  const needsFunds = balance < 1;
  const needsApprovals = wallet.approvalsReady === false;
  const isReady =
    !needsFunds && wallet.approvalsReady === true;
  const fundingAddress =
    wallet.signatureType === "proxy" && wallet.proxyAddress
      ? wallet.proxyAddress
      : wallet.address;
  const fundingLabel =
    wallet.signatureType === "proxy" && wallet.proxyAddress
      ? "Proxy"
      : "Wallet";

  return (
    <div className="t-panel">
      <div className="t-panel-label" style={{ marginBottom: 8 }}>
        <span>Wallet</span>
        {isReady ? (
          <span className="t-pill ready">ready</span>
        ) : needsFunds ? (
          <span className="t-pill warn">unfunded</span>
        ) : needsApprovals ? (
          <span className="t-pill warn">approvals needed</span>
        ) : (
          <span className="t-pill warn">setup</span>
        )}
      </div>

      <div className="t-row">
        <span className="k">{fundingLabel}</span>
        {fundingAddress ? (
          <button
            type="button"
            onClick={() => copyAddress(fundingAddress)}
            className="v hover:text-[var(--amber)] cursor-pointer text-left bg-transparent border-0 p-0 font-[inherit] text-[12px]"
            title="Click to copy"
          >
            {shortAddr(fundingAddress)} {copied ? "✓" : "⧉"}
          </button>
        ) : (
          <span className="v text-[var(--text-faint)]">—</span>
        )}
      </div>
      <div className="t-row">
        <span className="k">USDC</span>
        <span
          className="v"
          style={{ color: balance > 0 ? "var(--amber)" : "var(--text-faint)" }}
        >
          {fmtUsd(wallet.usdcBalanceUsd)}
        </span>
      </div>
      <div className="t-row">
        <span className="k">Approvals</span>
        <span
          className="v"
          style={{
            color:
              wallet.approvalsReady === true
                ? "var(--green)"
                : wallet.approvalsReady === false
                  ? "var(--amber)"
                  : "var(--text-faint)",
          }}
        >
          {wallet.approvalsReady === true
            ? "ready"
            : wallet.approvalsReady === false
              ? "needed"
              : "—"}
        </span>
      </div>

      {needsFunds && fundingAddress ? (
        <div className="mt-3 pt-3" style={{ borderTop: "1px solid var(--border-2)" }}>
          <button
            type="button"
            onClick={() => setQrOpen((v) => !v)}
            className="t-history-toggle w-full justify-between"
            style={{ color: "var(--amber)" }}
            title={qrOpen ? "Hide QR" : "Show QR"}
          >
            <span>Fund this wallet</span>
            <span style={{ color: "var(--text-dim)" }}>{qrOpen ? "▾" : "▸"}</span>
          </button>
          {qrOpen ? (
            <>
              <div
                className="flex justify-center mt-2 mb-2 p-2"
                style={{ background: "#fff" }}
              >
                <QRCodeSVG
                  value={fundingAddress}
                  size={140}
                  level="M"
                  bgColor="#ffffff"
                  fgColor="#000000"
                />
              </div>
              <button
                type="button"
                onClick={() => copyAddress(fundingAddress)}
                className="t-addr-box"
                title="Click to copy"
              >
                <span>{fundingAddress}</span>
                <span className="text-[var(--text-dim)]">{copied ? "✓" : "⧉"}</span>
              </button>
              <div className="text-[10.5px] text-[var(--text-faint)] mt-2 leading-relaxed">
                Send <span className="text-[var(--text-dim)]">USDC</span> on{" "}
                <span className="text-[var(--text-dim)]">Polygon</span> to this
                address. Also send a little MATIC for gas to the signer EOA{" "}
                {wallet.address ? (
                  <span className="text-[var(--text-dim)]">
                    {shortAddr(wallet.address)}
                  </span>
                ) : null}
                .
              </div>
            </>
          ) : null}
        </div>
      ) : null}

      {needsApprovals && !needsFunds ? (
        <div className="mt-3 pt-3 text-[10.5px] text-[var(--text-dim)] leading-relaxed" style={{ borderTop: "1px solid var(--border-2)" }}>
          Wallet funded. Ask the broker to{" "}
          <span className="text-[var(--amber)]">run approvals</span> before
          placing a trade.
        </div>
      ) : null}
    </div>
  );
}
