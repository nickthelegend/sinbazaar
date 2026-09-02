use anchor_lang::prelude::*;

/// Maximum simultaneous bidders per market. Bounded because `resolve` walks every
/// bid account through `remaining_accounts` in a single ER transaction.
pub const MAX_BIDDERS: usize = 8;

/// Confession body, stored ONLY inside the PER-permissioned `Secret` account.
pub const MAX_BODY_LEN: usize = 180;

/// A single redacted sentence — the most a `RandomReveal` outcome ever publishes.
pub const MAX_REDACTED_LEN: usize = 96;

/// Bytes a tombstone can carry on L1. Only ever written for reveal outcomes.
pub const MAX_TOMB_BODY: usize = MAX_BODY_LEN;

/// The village: one per authority, lives on the base layer, never delegated.
#[account]
pub struct Village {
    pub authority: Pubkey,
    pub market_count: u64,
    /// Fiction mode is ON by default. Seeded content is startup-village satire only.
    pub fiction_mode: bool,
    pub bump: u8,
}

impl Village {
    pub const LEN: usize = 32 + 8 + 1 + 1;
}

/// Which room of the bazaar a market belongs to.
///
/// The first four are LIVE. Everything after `MirrorConfession` is typed into the
/// program deliberately but rejected by `create_market` — they are Phase 7 rooms
/// shown as disabled cards in the UI, not half-built code paths.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug)]
pub enum Room {
    // ---- live ----
    GuiltMarket,
    BlackmailEscrow,
    WhisperIpo,
    MirrorConfession,
    // ---- phase 7: enumerated, disabled ----
    ApologyBonds,
    InheritanceOfSin,
    ScapegoatAuction,
    LastMessageWins,
    CursePool,
    ConfessionBondingCurve,
    AbsolutionAmm,
    AnonymousPatron,
    RedactionRoulette,
    DeadMansTweet,
    JuryOfSeven,
    Stain,
    ConfessorsBooth,
    SinFutures,
    ReputationHostage,
    VillageWill,
    SinOracle,
    CloneConfession,
    CowardsInsurance,
    PublicPenance,
    ForgettingAnnex,
}

impl Room {
    /// Only these rooms have a full create -> bid -> VRF -> settle -> tombstone loop.
    pub fn is_live(&self) -> bool {
        matches!(
            self,
            Room::GuiltMarket | Room::BlackmailEscrow | Room::WhisperIpo
        )
    }

    /// Rooms whose payoff is decided by SEAL/READ bidding and resolved by VRF.
    pub fn is_confession_market(&self) -> bool {
        matches!(self, Room::GuiltMarket | Room::BlackmailEscrow)
    }
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug)]
pub enum MarketStatus {
    /// Accepting bids on the ER.
    Open,
    /// Past `expires_at`, bids closed, awaiting randomness.
    Expired,
    /// `request_resolution_vrf` accepted; waiting on the oracle callback.
    VrfPending,
    /// Outcome decided. Escrow can now be settled.
    Resolved,
    /// Escrow drained, every bid closed. Safe to commit + undelegate.
    Settled,
}

/// The verdict of the village. Written on-chain and carved into the L1 tombstone.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug)]
pub enum Outcome {
    Pending,
    /// Seal pot won. Body stays private forever; tombstone carries the hash only.
    Buried,
    /// VRF picked exactly one READ bidder. Only they gain PER read access.
    SoleReader,
    /// VRF exposed a single redacted sentence on L1.
    RandomReveal,
    /// Nobody paid. The full body is carved into the L1 tombstone.
    PublicLeak,
    /// Blackmail escrow: full body granted to one random active villager.
    Inherited,
    /// Whisper IPO resolved YES.
    Forgiven,
    /// Whisper IPO resolved NO.
    Slashed,
    ExportWinner,
    CurseHit,
    CurseMiss,
    /// Author cancelled before any bid landed.
    Cancelled,
}

impl Outcome {
    /// True when the outcome authorises plaintext (or a redaction) on the public L1
    /// tombstone. Every other outcome must publish the hash alone.
    pub fn reveals_text(&self) -> bool {
        matches!(self, Outcome::PublicLeak | Outcome::RandomReveal)
    }
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug)]
pub enum BidSide {
    /// Pay to keep it buried.
    Seal,
    /// Pay to become a candidate sole reader.
    Read,
    /// Whisper IPO long.
    Yes,
    /// Whisper IPO short.
    No,
}

/// Public market state. Delegated to the ER so bidding is real-time, but its
/// ephemeral permission is deliberately NON-private: hash, timer, pots and status
/// are meant to be readable by anyone. The body never lives here.
#[account]
pub struct Market {
    pub village: Pubkey,
    pub market_id: u64,
    pub author: Pubkey,
    pub room: Room,
    /// sha256(body || salt) — published at creation, verifiable after any reveal.
    pub commitment_hash: [u8; 32],
    pub created_at: i64,
    pub expires_at: i64,
    pub seal_pot: u64,
    pub read_pot: u64,
    /// Whisper IPO books.
    pub yes_pot: u64,
    pub no_pot: u64,
    /// Blackmail escrow ransom curve: floor + slope * seconds_elapsed.
    pub ransom_floor: u64,
    pub ransom_slope: u64,
    pub bid_count: u8,
    pub closed_bid_count: u8,
    pub read_bid_count: u8,
    pub status: MarketStatus,
    pub outcome: Outcome,
    /// Set by the VRF callback for SoleReader / Inherited outcomes.
    pub sole_reader: Pubkey,
    /// Raw randomness the oracle delivered, kept for auditability.
    pub randomness: u64,
    pub resolved_at: i64,
    /// Lamports this PDA holds on behalf of bidders (excludes rent + sponsor float).
    pub escrow_lamports: u64,
    /// Forfeited stakes owed to the author, claimable on L1 after settlement.
    pub author_payout: u64,
    /// Whisper IPO attested result: 0 unresolved, 1 YES, 2 NO.
    pub rumor_result: u8,
    pub tombstoned: bool,
    /// Reveal buffer. Stays all-zero unless `outcome.reveals_text()`. Filled on the
    /// ER at finalize time by copying out of the private `Secret`, immediately
    /// before the market is committed to L1 — so plaintext reaches the base layer
    /// only when the verdict authorised it.
    pub revealed_len: u16,
    pub revealed: [u8; MAX_TOMB_BODY],
    /// The salt, published alongside a reveal and only then. Without it nobody can
    /// check `sha256(revealed || salt)` against `commitment_hash`, because the salt
    /// otherwise lives only inside the private secret.
    pub revealed_salt: [u8; 32],
    pub bump: u8,
}

impl Market {
    pub const LEN: usize = 32  // village
        + 8      // market_id
        + 32     // author
        + 1      // room
        + 32     // commitment_hash
        + 8 + 8  // created_at, expires_at
        + 8 + 8  // seal_pot, read_pot
        + 8 + 8  // yes_pot, no_pot
        + 8 + 8  // ransom_floor, ransom_slope
        + 1 + 1 + 1 // bid_count, closed_bid_count, read_bid_count
        + 1 + 1  // status, outcome
        + 32     // sole_reader
        + 8      // randomness
        + 8      // resolved_at
        + 8      // escrow_lamports
        + 8      // author_payout
        + 1      // rumor_result
        + 1      // tombstoned
        + 2 + MAX_TOMB_BODY // revealed_len, revealed
        + 32     // revealed_salt
        + 1; // bump

    /// Ransom the village must raise to bury a blackmail market, at `now`.
    pub fn ransom_due(&self, now: i64) -> u64 {
        let elapsed = now.saturating_sub(self.created_at).max(0) as u64;
        self.ransom_floor
            .saturating_add(self.ransom_slope.saturating_mul(elapsed))
    }
}

/// The confession itself. Delegated to the TEE validator and gated by an ephemeral
/// permission whose member list starts as `[author]`.
///
/// For confession rooms the permission is PRIVATE, so the body is unreadable over
/// any RPC by anyone but the author. For Whisper IPO the same account holds the
/// rumor headline with a PUBLIC permission — the rumor is meant to be read; it is
/// the positions that stay hidden. Nothing here is ever copied to the base layer
/// unless `Outcome::reveals_text()`.
#[account]
pub struct Secret {
    pub market: Pubkey,
    pub author: Pubkey,
    pub salt: [u8; 32],
    pub body_len: u16,
    pub body: [u8; MAX_BODY_LEN],
    /// Author-supplied single sentence, the only thing a RandomReveal may publish.
    pub redacted_len: u16,
    pub redacted: [u8; MAX_REDACTED_LEN],
    pub bump: u8,
}

impl Secret {
    pub const LEN: usize =
        32 + 32 + 32 + 2 + MAX_BODY_LEN + 2 + MAX_REDACTED_LEN + 1;
}

/// A bid. Created as an ER-only ephemeral account, sponsored by the market PDA,
/// and gated by a private permission listing only the bidder — so the amount and
/// the side stay hidden from everyone, the author included.
#[account]
pub struct Bid {
    pub market: Pubkey,
    pub bidder: Pubkey,
    pub side: BidSide,
    pub amount: u64,
    /// Arrival order across all bids on this market.
    pub index: u8,
    /// Arrival order among READ bids only. Lets any cranker derive the VRF-selected
    /// reader without holding every bid account in one transaction.
    pub read_rank: u8,
    /// Set by `fund_bid`. An unfunded bid holds no money and settles for zero.
    pub funded: bool,
    pub settled: bool,
    pub bump: u8,
}

impl Bid {
    pub const LEN: usize = 32 + 32 + 1 + 8 + 1 + 1 + 1 + 1 + 1;
}

/// A villager's spending purse. Funded with real SOL on the base layer, then
/// delegated to the ER so every bid is an ER-native lamport move with no wallet
/// round trip and no base-layer transaction per click.
#[account]
pub struct Purse {
    pub owner: Pubkey,
    /// Lamports available to bid, tracked separately from the account's rent.
    pub available: u64,
    /// Lamports currently locked in open bids.
    pub locked: u64,
    pub bump: u8,
}

impl Purse {
    pub const LEN: usize = 32 + 8 + 8 + 1;
}

/// A scoped session key. Lets a villager bid repeatedly without a wallet popup,
/// while the program enforces the scope the wallet actually consented to.
#[account]
pub struct SessionScope {
    pub owner: Pubkey,
    pub session_key: Pubkey,
    /// Restricted to a single market. `Pubkey::default()` is NOT accepted.
    pub market: Pubkey,
    pub expires_at: i64,
    pub max_spend: u64,
    pub spent: u64,
    pub revoked: bool,
    pub bump: u8,
}

impl SessionScope {
    pub const LEN: usize = 32 + 32 + 32 + 8 + 8 + 8 + 1 + 1;

    pub fn is_valid(&self, now: i64, market: &Pubkey, signer: &Pubkey) -> bool {
        !self.revoked
            && self.session_key == *signer
            && self.market == *market
            && now < self.expires_at
    }
}

/// The graveyard entry. Written on the BASE layer after settlement and never
/// deleted. Carries plaintext only when the outcome authorised it.
#[account]
pub struct Tombstone {
    pub market: Pubkey,
    pub market_id: u64,
    pub author: Pubkey,
    pub room: Room,
    pub commitment_hash: [u8; 32],
    pub outcome: Outcome,
    pub seal_pot: u64,
    pub read_pot: u64,
    pub sole_reader: Pubkey,
    pub randomness: u64,
    pub buried_at: i64,
    pub revealed_len: u16,
    pub revealed: [u8; MAX_TOMB_BODY],
    /// Present only for outcomes that publish text, so anyone can verify
    /// `sha256(revealed || salt) == commitment_hash` without ever seeing the rollup.
    pub revealed_salt: [u8; 32],
    pub bump: u8,
}

impl Tombstone {
    pub const LEN: usize =
        32 + 8 + 32 + 1 + 32 + 1 + 8 + 8 + 32 + 8 + 8 + 2 + MAX_TOMB_BODY + 32 + 1;
}
