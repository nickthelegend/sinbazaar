/**
 * The rooms of the bazaar, in the order they appear in the `Room` enum in
 * programs/sinbazaar/src/state.rs.
 *
 * Three are LIVE — they have a full create -> bid -> VRF -> settle -> tombstone
 * loop. The rest are enumerated in the program deliberately and rejected by
 * `create_market` (`Room::is_live()`), so the UI shows them as disabled cards
 * rather than half-built code paths.
 *
 * Every rule is startup-village satire. Fiction mode, always.
 */

export type SideName = "seal" | "read" | "yes" | "no";

export interface RoomMeta {
  /** Rust variant name. */
  name: string;
  /** Anchor's camelCase key — both the argument shape and the fetched value. */
  variant: string;
  label: string;
  /** Two lines. The card shows both; nothing else fits a stall sign. */
  rule: [string, string];
  live: boolean;
  /** `Room::is_confession_market()` — payoff decided by SEAL/READ bidding. */
  confessionMarket: boolean;
  sides: [SideName, SideName];
}

const room = (
  name: string,
  label: string,
  rule: [string, string],
  opts: { live?: boolean; confession?: boolean; sides?: [SideName, SideName] } = {}
): RoomMeta => ({
  name,
  variant: name.charAt(0).toLowerCase() + name.slice(1),
  label,
  rule,
  live: opts.live ?? false,
  confessionMarket: opts.confession ?? false,
  sides: opts.sides ?? ["seal", "read"],
});

export const ROOMS: RoomMeta[] = [
  // ---- live ----
  room(
    "GuiltMarket",
    "Guilt Market",
    [
      "Pay SEAL to bury it, or pay READ for the chance to be its one reader.",
      "Any seal money buries it. Seal empty and read funded, VRF picks the reader. Both empty, the village reads everything.",
    ],
    { live: true, confession: true }
  ),
  room(
    "BlackmailEscrow",
    "Blackmail Escrow",
    [
      "A ransom climbs every second the confession stays unbought.",
      "Meet it and it is buried. Fall short and the randomness decides who inherits the file.",
    ],
    { live: true, confession: true }
  ),
  room(
    "WhisperIpo",
    "Whisper IPO",
    [
      "The rumor is public from the first block. Trade YES or NO on whether it holds.",
      "Your position stays private. The winning book eats the losing one, pro rata.",
    ],
    { live: true, sides: ["yes", "no"] }
  ),

  // ---- phase 2: enumerated, disabled ----
  room("MirrorConfession", "Mirror Confession", [
    "Two villagers open at the same instant and each is shown only the other's.",
    "Neither ever learns whether the trade was honest.",
  ]),
  room("ApologyBonds", "Apology Bonds", [
    "Issue debt against a promise to make it right before the next standup.",
    "Coupons pay out of whatever shame the village is willing to price.",
  ]),
  room("InheritanceOfSin", "Inheritance of Sin", [
    "Name a successor who receives the confession if you go quiet.",
    "Silence past the deadline executes the will on its own.",
  ]),
  room("ScapegoatAuction", "Scapegoat Auction", [
    "Bid to have the blame filed under somebody else's name.",
    "The lowest bidder is simply the one who wanted it least.",
  ]),
  room("LastMessageWins", "Last Message Wins", [
    "Every new message resets the clock and raises the floor.",
    "Whoever spoke last when it hits zero takes the whole pot.",
  ]),
  room("CursePool", "Curse Pool", [
    "Stake against a rival team's demo shipping on the day they promised.",
    "The pool pays whoever bet on the direction reality actually took.",
  ]),
  room("ConfessionBondingCurve", "Confession Bonding Curve", [
    "Each buyer of a fragment pushes the next fragment's price up the curve.",
    "Sell back before the final sentence prints, or hold the bag and the sentence.",
  ]),
  room("AbsolutionAmm", "Absolution AMM", [
    "A constant-product pool between guilt and forgiveness.",
    "Arbitrage the spread until the village feels roughly even again.",
  ]),
  room("AnonymousPatron", "Anonymous Patron", [
    "One benefactor quietly funds the seal pot to the ceiling.",
    "Nobody learns who paid — the author least of all.",
  ]),
  room("RedactionRoulette", "Redaction Roulette", [
    "The randomness chooses which single sentence stays blacked out.",
    "Everything it does not choose is published verbatim.",
  ]),
  room("DeadMansTweet", "Dead Man's Tweet", [
    "Check in every day or the draft posts itself.",
    "One missed heartbeat and the whole village reads it.",
  ]),
  room("JuryOfSeven", "Jury of Seven", [
    "Seven random villagers read it once and vote bury or burn.",
    "A tie sends the confession back for one more round.",
  ]),
  room("Stain", "Stain", [
    "A confession that never fully clears; it only fades on a schedule.",
    "Paying speeds the fade. Ignoring it slows the fade down.",
  ]),
  room("ConfessorsBooth", "Confessor's Booth", [
    "A single paid listener, one session, no record kept anywhere.",
    "The booth closes the moment the timer does.",
  ]),
  room("SinFutures", "Sin Futures", [
    "Write contracts on confessions that have not been made yet.",
    "Settle against whatever the village admits to by expiry.",
  ]),
  room("ReputationHostage", "Reputation Hostage", [
    "Lock your own standing in the village as collateral behind a claim.",
    "Be wrong and the village keeps the deposit.",
  ]),
  room("VillageWill", "Village Will", [
    "Bequeath every secret you still hold to a named heir.",
    "Probate runs on a timer that nobody, including you, can pause.",
  ]),
  room("SinOracle", "Sin Oracle", [
    "Ask the village a yes/no question about somebody who is not in the room.",
    "The answer costs more the closer the question gets to a name.",
  ]),
  room("CloneConfession", "Clone Confession", [
    "Mint a second copy of a confession under a different author's hash.",
    "Exactly one of the two is the original. Which one is never disclosed.",
  ]),
  room("CowardsInsurance", "Coward's Insurance", [
    "Pay a premium now against being named in someone else's confession later.",
    "A claim pays out only if the leak was not your own doing.",
  ]),
  room("PublicPenance", "Public Penance", [
    "Buy your way out by doing something visibly, deliberately worse.",
    "The village prices the penance, never the sin.",
  ]),
  room("ForgettingAnnex", "Forgetting Annex", [
    "A tombstone can be paid to blur. It can never be paid to vanish.",
    "The hash stays forever; the sentence just stops being legible.",
  ]),
];

export const LIVE_ROOMS = ROOMS.filter((r) => r.live);
export const PHASE_TWO_ROOMS = ROOMS.filter((r) => !r.live);

const BY_VARIANT = new Map(ROOMS.map((r) => [r.variant, r]));

/** Resolve a fetched `market.room` (`{ guiltMarket: {} }`) to its metadata. */
export function roomOf(value: unknown): RoomMeta {
  const key = value && typeof value === "object" ? Object.keys(value as object)[0] : undefined;
  return (key && BY_VARIANT.get(key)) || ROOMS[0];
}

/** The argument shape Anchor expects for a `Room`. */
export const roomArg = (variant: string): Record<string, Record<string, never>> => ({
  [variant]: {},
});

/** The argument shape Anchor expects for a `BidSide`. */
export const sideArg = (side: SideName): Record<string, Record<string, never>> => ({
  [side]: {},
});

export const SIDE_LABEL: Record<SideName, string> = {
  seal: "SEAL",
  read: "READ",
  yes: "YES",
  no: "NO",
};
