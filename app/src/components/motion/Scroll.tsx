"use client";

/**
 * GSAP ScrollTrigger primitives.
 *
 * Every one registers inside `useGSAP`, so the context reverts on unmount and
 * nothing leaks across route changes. None of them listen to a scroll event
 * directly: ScrollTrigger batches reads and writes against a single rAF, which
 * is the difference between smooth and janky.
 *
 * All of them no-op under `prefers-reduced-motion`. Because every animation is a
 * `from` with the resting state already in the markup, a no-op leaves content
 * fully visible rather than stuck at opacity zero.
 */
import { useEffect, useRef } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useGSAP } from "@gsap/react";

if (typeof window !== "undefined") {
  gsap.registerPlugin(ScrollTrigger);
}

const reduced = () =>
  typeof window !== "undefined" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * Run `fn` when the document is actually visible, now or later.
 *
 * GSAP drives everything off requestAnimationFrame, and a hidden tab throttles
 * rAF to nothing. A page opened in a background tab would therefore hide its own
 * content behind an entrance that never ticks, and the reader would find a blank
 * hero when they finally switched to it. So nothing is ever hidden until we know
 * the frames will arrive: if the document is hidden, we wait for it to surface
 * and only then set the start state and play.
 */
function whenVisible(fn: () => void): (() => void) | undefined {
  if (typeof document === "undefined") return;
  if (document.visibilityState === "visible") {
    fn();
    return;
  }
  const on = () => {
    if (document.visibilityState === "visible") {
      document.removeEventListener("visibilitychange", on);
      fn();
    }
  };
  document.addEventListener("visibilitychange", on);
  return () => document.removeEventListener("visibilitychange", on);
}

/** A one-time entrance: children rise and settle in sequence. */
export function StaggerIn({
  children,
  selector = ":scope > *",
  y = 26,
  stagger = 0.075,
  className,
}: {
  children: React.ReactNode;
  selector?: string;
  y?: number;
  stagger?: number;
  className?: string;
}) {
  const scope = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      if (reduced()) return;
      const targets = scope.current?.querySelectorAll(selector);
      if (!targets?.length) return;
      // Movement only. The visibility gate below already stops this running when
      // frames will not arrive, but an entrance that also owns opacity can strand
      // its content if the tween is interrupted for any other reason. Section
      // headings are content; they do not get to be conditional.
      return whenVisible(() => {
      gsap.fromTo(
        targets,
        { y },
        {
          y: 0,
          duration: 0.85,
          stagger,
          ease: "power3.out",
          scrollTrigger: { trigger: scope.current, start: "top 82%", once: true },
        }
      );
      });
    },
    { scope }
  );

  return (
    <div ref={scope} className={className}>
      {children}
    </div>
  );
}

/**
 * A sticky, stepped sequence.
 *
 * The stage sticks to the viewport while the reader scrolls through one tall
 * sentinel per step, and an IntersectionObserver decides which step is active.
 *
 * This deliberately does NOT use ScrollTrigger's pin with a scrub. Pinning drives
 * its progress off GSAP's rAF ticker, and a throttled tab stops that ticker dead:
 * measured here, the sequence froze on step one and the other two became
 * unreachable. IntersectionObserver fires from the browser's own compositing
 * work, so the steps advance whether or not a frame is ever painted. GSAP still
 * drives the scrubbed progress bar, because that is decoration and may safely
 * stall; the content may not.
 */
export function PinnedSequence({
  children,
  steps,
  onStep,
  className,
}: {
  children: React.ReactNode;
  steps: number;
  onStep: (index: number) => void;
  className?: string;
}) {
  const scope = useRef<HTMLDivElement>(null);
  const cb = useRef(onStep);
  cb.current = onStep;

  useEffect(() => {
    const root = scope.current;
    if (!root) return;

    // Geometry read off a passive scroll listener, not an IntersectionObserver
    // and not ScrollTrigger's scrub.
    //
    // Both of those deliver their callbacks inside the browser's rendering
    // steps, which a backgrounded or throttled tab stops running. Measured in
    // two different browsers here, the sequence froze on step one and the other
    // two became permanently unreachable. Scroll events fire regardless, and
    // three getBoundingClientRect calls per event is nothing.
    let last = -1;
    const pick = () => {
      const marks = root.querySelectorAll<HTMLElement>("[data-step]");
      if (!marks.length) return;
      const eye = window.innerHeight * 0.5;
      let best = 0;
      let bestDist = Infinity;
      marks.forEach((m, i) => {
        const r = m.getBoundingClientRect();
        const dist = Math.abs(r.top + r.height / 2 - eye);
        if (dist < bestDist) {
          bestDist = dist;
          best = i;
        }
      });
      if (best !== last) {
        last = best;
        cb.current(best);
      }
    };

    pick();
    window.addEventListener("scroll", pick, { passive: true });
    window.addEventListener("resize", pick, { passive: true });
    return () => {
      window.removeEventListener("scroll", pick);
      window.removeEventListener("resize", pick);
    };
  }, [steps]);

  // The scroll length is an explicit height on the container, and the marks are
  // absolutely positioned bands inside it. Giving the stage a negative margin
  // instead broke the sticky containing block: the stage never released and
  // bled over the section below it.
  return (
    <div
      ref={scope}
      className={className}
      style={{ height: `${steps * 92}dvh`, position: "relative" }}
    >
      <div className="seq-stage">{children}</div>
      <div className="seq-rail" aria-hidden="true">
        {Array.from({ length: steps }, (_, i) => (
          <div
            className="seq-mark"
            data-step={i}
            key={i}
            style={{ top: `${(i * 100) / steps}%`, height: `${100 / steps}%` }}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * A number that counts to its real value when it scrolls into view.
 *
 * The value is passed in, never invented. `snap` keeps it on integers so the
 * digits do not flicker through fractions on the way up.
 */
export function CountUp({ to, suffix = "" }: { to: number; suffix?: string }) {
  const el = useRef<HTMLSpanElement>(null);

  useGSAP(
    () => {
      if (!el.current) return;
      if (reduced()) return;
      return whenVisible(() => {
        const obj = { n: 0 };
        // The zero is written by the tween's own first frame, never up front.
        // Setting it here and trusting the tween to correct it means anything
        // that stops the ticker, a throttled tab most of all, leaves the figure
        // reading zero, which is a false statement rather than a lost animation.
        gsap.to(obj, {
          n: to,
          duration: 1.4,
          ease: "power2.out",
          snap: { n: 1 },
          onUpdate: () => {
            if (el.current) el.current.textContent = `${Math.round(obj.n)}${suffix}`;
          },
          onComplete: () => {
            // Always land on the exact figure, never on a rounding artefact.
            if (el.current) el.current.textContent = `${to}${suffix}`;
          },
          scrollTrigger: { trigger: el.current, start: "top 88%", once: true },
        });
      });
    },
    { dependencies: [to, suffix] }
  );

  // The rendered value is the REAL number, and the animation counts up to it
  // from zero only if it actually gets to run. Rendering 0 and relying on the
  // tween to correct it means a throttled tab, a reduced-motion reader or a
  // failed script shows every figure as zero, which is not a missing animation,
  // it is a false statement about the product.
  return (
    <span ref={el}>{`${to}${suffix}`}</span>
  );
}

/** Scrubbed parallax drift. Used only where depth is the point. */
export function Drift({
  children,
  distance = -70,
  className,
}: {
  children: React.ReactNode;
  distance?: number;
  className?: string;
}) {
  const scope = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      if (!scope.current || reduced()) return;
      gsap.to(scope.current, {
        y: distance,
        ease: "none",
        scrollTrigger: {
          trigger: scope.current,
          start: "top bottom",
          end: "bottom top",
          scrub: true,
        },
      });
    },
    { scope, dependencies: [distance] }
  );

  return (
    <div ref={scope} className={className}>
      {children}
    </div>
  );
}

/**
 * The hero entrance.
 *
 * A real timeline rather than a stagger: the eyebrow, the headline words, the
 * subtitle and the buttons each land on their own beat, and the clock starts
 * only once the line has finished arriving.
 */
export function HeroIntro({ children }: { children: React.ReactNode }) {
  const scope = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      if (!scope.current) return;
      const q = gsap.utils.selector(scope.current);
      const all = [
        ...q("[data-hero='eyebrow']"),
        ...q("[data-hero='word']"),
        ...q("[data-hero='sub']"),
        ...q("[data-hero='cta']"),
        ...q("[data-hero='clock']"),
      ];
      if (reduced()) {
        gsap.set(all, { clearProps: "all" });
        return;
      }

      // fromTo, never from. React StrictMode mounts twice in development, and
      // useGSAP reverts the context between the two runs; a bare `from` then
      // captures the already-reverted start values as its END state and the
      // whole hero sticks at opacity 0. Explicit end values cannot do that.
      return whenVisible(() => {
      const tl = gsap.timeline({ defaults: { ease: "power3.out" } });
      tl.fromTo(
        q("[data-hero='eyebrow']"),
        { y: 16, opacity: 0 },
        { y: 0, opacity: 1, duration: 0.6 }
      )
        .fromTo(
          q("[data-hero='word']"),
          { yPercent: 118 },
          { yPercent: 0, duration: 0.9, stagger: 0.075 },
          "-=0.25"
        )
        .fromTo(
          q("[data-hero='sub']"),
          { y: 18, opacity: 0 },
          { y: 0, opacity: 1, duration: 0.7 },
          "-=0.45"
        )
        .fromTo(
          q("[data-hero='cta']"),
          { y: 14, opacity: 0 },
          { y: 0, opacity: 1, duration: 0.6, stagger: 0.08 },
          "-=0.4"
        )
        .fromTo(
          q("[data-hero='clock']"),
          { opacity: 0, scale: 0.94 },
          { opacity: 1, scale: 1, duration: 0.7 },
          "-=0.35"
        );
      });
    },
    { scope }
  );

  return <div ref={scope}>{children}</div>;
}
