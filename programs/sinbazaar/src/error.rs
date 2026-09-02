use anchor_lang::prelude::*;

#[error_code]
pub enum SinError {
    #[msg("amount must be greater than zero")]
    InvalidAmount,
    #[msg("expiry must be in the future")]
    ExpiryInPast,
    #[msg("this room is enumerated but not enabled in this build")]
    RoomNotLive,
    #[msg("wrong room for this instruction")]
    WrongRoom,
    #[msg("market is not open for bidding")]
    MarketNotOpen,
    #[msg("market has not expired yet")]
    MarketStillOpen,
    #[msg("market is not expired")]
    MarketNotExpired,
    #[msg("market outcome is not resolved yet")]
    NotResolved,
    #[msg("market is already resolved")]
    AlreadyResolved,
    #[msg("market escrow is not fully settled")]
    NotSettled,
    #[msg("not every bid has been settled and closed")]
    UnsettledBids,
    #[msg("too many bidders for this market")]
    TooManyBidders,
    /// Reserved. Survives from the earlier design where `resolve` walked every bid
    /// through `remaining_accounts` in one transaction; not thrown today. Kept so the
    /// error numbers below it stay stable. Same for `DuplicateBid`,
    /// `CommitmentMismatch`, `VrfAlreadyRequested` and `VrfNotDelivered`.
    #[msg("bid account is missing from remaining_accounts")]
    MissingBid,
    #[msg("bid account does not belong to this market")]
    InvalidBid,
    #[msg("duplicate bid account supplied")]
    DuplicateBid,
    #[msg("bid was already settled")]
    BidAlreadySettled,
    #[msg("bid side is not valid for this room")]
    InvalidBidSide,
    #[msg("purse has insufficient available lamports")]
    InsufficientFunds,
    #[msg("purse still has lamports locked in open bids")]
    PurseLocked,
    #[msg("confession body is empty or exceeds the maximum length")]
    InvalidBodyLength,
    #[msg("redacted sentence exceeds the maximum length")]
    InvalidRedactionLength,
    #[msg("commitment hash does not match the supplied body and salt")]
    CommitmentMismatch,
    #[msg("caller is not the author of this secret")]
    NotAuthor,
    #[msg("session key is expired, revoked, or out of scope")]
    InvalidSession,
    #[msg("session spend limit exceeded")]
    SessionLimitExceeded,
    #[msg("randomness has already been requested for this market")]
    VrfAlreadyRequested,
    #[msg("randomness has not been delivered yet")]
    VrfNotDelivered,
    #[msg("this outcome does not authorise publishing plaintext")]
    RevealNotAuthorised,
    #[msg("tombstone already written for this market")]
    AlreadyTombstoned,
    #[msg("rumor result must be 1 (YES) or 2 (NO)")]
    InvalidRumorResult,
    #[msg("caller is not the village authority")]
    NotVillageAuthority,
    #[msg("arithmetic overflow")]
    MathOverflow,
    #[msg("nothing to claim")]
    NothingToClaim,
    #[msg("market still holds escrowed lamports")]
    EscrowNotEmpty,
}
