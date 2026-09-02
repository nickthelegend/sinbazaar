"use client";

/** Small shared pieces of the stall. */
import { useNow } from "@/hooks/useNow";
import { fmtCountdown, fmtSol, OUTCOME_LABEL, STATUS_LABEL } from "@/lib/format";
import type { FlowStep, StepState } from "@/lib/flows";

export function Countdown({ expiresAt, compact }: { expiresAt: number; compact?: boolean }) {
  const now = useNow();
  if (now === 0) return <span className="countdown">--:--</span>;
  const left = expiresAt - now;
  const cls = left <= 0 ? "countdown dead" : left <= 20 ? "countdown urgent" : "countdown";
  return (
    <span className={cls}>
      {left <= 0 ? "00:00" : fmtCountdown(left)}
      {!compact && left <= 0 ? <span className="countdown-note"> timer dead</span> : null}
    </span>
  );
}

export function StatusPill({ status }: { status: string }) {
  return <span className={`pill status-${status}`}>{STATUS_LABEL[status] ?? status}</span>;
}

export function OutcomeBadge({ outcome }: { outcome: string }) {
  if (!outcome || outcome === "pending") return null;
  return <span className={`pill outcome-${outcome}`}>{OUTCOME_LABEL[outcome] ?? outcome}</span>;
}

export function PotBar({ seal, read }: { seal: number; read: number }) {
  const total = seal + read;
  const sealPct = total === 0 ? 50 : (seal / total) * 100;
  return (
    <div className="pots">
      <div className="pot-bar" aria-hidden="true">
        <div className={total === 0 ? "seg seal empty" : "seg seal"} style={{ width: `${sealPct}%` }} />
        <div
          className={total === 0 ? "seg read empty" : "seg read"}
          style={{ width: `${100 - sealPct}%` }}
        />
      </div>
      <div className="pot-figures">
        <span className="pot seal">
          <em>SEAL</em> {fmtSol(seal)}
        </span>
        <span className="pot read">
          <em>READ</em> {fmtSol(read)}
        </span>
      </div>
    </div>
  );
}

export function BookBar({ yes, no }: { yes: number; no: number }) {
  const total = yes + no;
  const yesPct = total === 0 ? 50 : (yes / total) * 100;
  return (
    <div className="pots">
      <div className="pot-bar" aria-hidden="true">
        <div className={total === 0 ? "seg read empty" : "seg read"} style={{ width: `${yesPct}%` }} />
        <div className={total === 0 ? "seg seal empty" : "seg seal"} style={{ width: `${100 - yesPct}%` }} />
      </div>
      <div className="pot-figures">
        <span className="pot read">
          <em>YES</em> {fmtSol(yes)}
        </span>
        <span className="pot seal">
          <em>NO</em> {fmtSol(no)}
        </span>
      </div>
    </div>
  );
}

export function StepList({
  steps,
  states,
  details,
}: {
  steps: FlowStep[];
  states: Record<string, StepState>;
  details?: Record<string, string>;
}) {
  return (
    <ol className="steps">
      {steps.map((s) => {
        const state = states[s.id] ?? "pending";
        return (
          <li key={s.id} className={`step ${state}`}>
            <span className="step-mark" aria-hidden="true">
              {state === "done" ? "✓" : state === "failed" ? "✕" : state === "running" ? "◌" : "·"}
            </span>
            <span className="step-body">
              <span className="step-head">
                <code>{s.label}</code>
                <span className={`layer layer-${s.layer}`}>{s.layer}</span>
              </span>
              <span className="step-note">{details?.[s.id] ?? s.note}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <div className="empty">{children}</div>;
}
