"use client";

/** Small shared pieces of the stall. */
import { Odometer } from "@/components/Odometer";
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
          <em>SEAL</em> <Odometer value={seal} format={fmtSol} />
        </span>
        <span className="pot read">
          <em>READ</em> <Odometer value={read} format={fmtSol} />
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

/**
 * A redaction bar.
 *
 * The signature graphic of this product. Where a confession exists but the
 * verdict did not authorise publishing it, the page shows the shape of the
 * withheld text rather than a sentence explaining that it is withheld. The
 * widths are fixed and deliberately arbitrary: nothing here encodes the real
 * length of the body, because the real length is itself private and leaking it
 * would be a small, stupid leak.
 */
export function Redaction({ label }: { label?: string }) {
  const bars = [
    [62, 26],
    [38, 44, 12],
    [22, 54],
  ];
  return (
    <div className="redaction-block" role="img" aria-label={label ?? "Redacted. The confession was not authorised for publication."}>
      <div className="redaction-rows">
      {bars.map((row, i) => (
        <div className="redaction-row" key={i}>
          {row.map((w, j) => (
            <span className="redaction" key={j} style={{ width: `${w}%` }} />
          ))}
        </div>
      ))}
      </div>
    </div>
  );
}

/**
 * A loading skeleton shaped like a market card.
 *
 * A centred word of text is not a loading state: the page reflows the moment
 * data lands. These blocks sit at the same size as the real card's room name,
 * hash line, clock and book, so the grid is already the right shape before the
 * rollup answers.
 */
export function CardSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="grid" aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <div className="market-card skeleton" key={i}>
          <div className="card-top">
            <span className="sk sk-title" />
            <span className="sk sk-badge" />
          </div>
          <span className="sk sk-hash" />
          <div className="card-mid">
            <span className="sk sk-clock" />
            <span className="sk sk-badge" />
          </div>
          <span className="sk sk-bar" />
          <div className="card-foot">
            <span className="sk sk-small" />
            <span className="sk sk-small" />
          </div>
        </div>
      ))}
    </div>
  );
}
