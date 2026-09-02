//! # SINBAZAAR
//!
//! A village of markets where the underlying asset is a secret.
//!
//! The confession lives in a **Private Ephemeral Rollup** and is unreadable over
//! any RPC by anyone outside its permission member list. The market on top of it
//! runs in real time on an **Ephemeral Rollup**, where every bid is an ER-native
//! lamport move signed by a scoped session key. When the timer hits zero,
//! **MagicBlock VRF** picks the reader. Solana only ever receives a tombstone.
//!
//! ## The one invariant
//!
//! Plaintext reaches the base layer only when the verdict authorised it. The
//! `Secret` account is allocated empty on L1 and delegated *before* a single byte
//! of the body is written — the body is only ever written on the ER, inside the
//! TEE, under a private permission. It is never undelegated.

use anchor_lang::prelude::*;
use solana_sha256_hasher::hashv;
use anchor_lang::system_program::{transfer as system_transfer, Transfer as SystemTransfer};
use ephemeral_rollups_sdk::{
    access_control::{
        instructions::{
            CloseEphemeralPermissionCpi, CreateEphemeralPermissionCpi,
            UpdateEphemeralPermissionCpi,
        },
        structs::{
            EphemeralMembersArgs, EphemeralPermission, Member, AUTHORITY_FLAG, PERMISSION_SEED,
            TX_BALANCES_FLAG, TX_LOGS_FLAG, TX_MESSAGE_FLAG,
        },
    },
    anchor::{commit, delegate, ephemeral, ephemeral_accounts, vrf, vrf_callback},
    consts::{EPHEMERAL_VAULT_ID, MAGIC_PROGRAM_ID, PERMISSION_PROGRAM_ID},
    cpi::DelegateConfig,
    ephem::MagicIntentBundleBuilder,
    vrf::{
        self as vrf_sdk,
        instructions::{create_request_scoped_randomness_ix, RequestRandomnessParams},
        types::SerializableAccountMeta,
    },
};

mod error;
mod state;

use error::SinError;
use state::*;

declare_id!("2WF8eFT97sGVYwGe5DNtLkGFW3kMJ6WXozGvT3eSzvEN");

pub const VILLAGE_SEED: &[u8] = b"village";
pub const MARKET_SEED: &[u8] = b"market";
pub const SECRET_SEED: &[u8] = b"secret";
pub const BID_SEED: &[u8] = b"bid";
pub const PURSE_SEED: &[u8] = b"purse";
pub const SESSION_SEED: &[u8] = b"session";
pub const TOMB_SEED: &[u8] = b"tomb";

/// Lamports the market PDA floats to sponsor ER-side rent: its own permission,
/// the secret's permission, and one ephemeral account + permission per bidder.
pub const SPONSOR_FLOAT: u64 = 40_000_000;

/// How long a market waits for the VRF oracle before anyone may re-request.
pub const VRF_GRACE_SECS: i64 = 120;

#[ephemeral]
#[program]
pub mod sinbazaar {
    use super::*;

    // =====================================================================
    // BASE LAYER
    // =====================================================================

    /// Open the village. Fiction mode is on by default and is a product-level
    /// declaration, not a security control.
    pub fn initialize_village(ctx: Context<InitializeVillage>, fiction_mode: bool) -> Result<()> {
        let village = &mut ctx.accounts.village;
        village.authority = ctx.accounts.authority.key();
        village.market_count = 0;
        village.fiction_mode = fiction_mode;
        village.bump = ctx.bumps.village;
        msg!("Village {} open. fiction_mode={}", village.key(), fiction_mode);
        Ok(())
    }

    /// Create the public half of a market: id, room, timer, pots, status.
    ///
    /// The market PDA is pre-funded so that once it reaches the ER it can sponsor
    /// its own permission, the secret's permission, and every bid's ephemeral
    /// account — none of which the bidders should have to pay for.
    pub fn create_market(
        ctx: Context<CreateMarket>,
        market_id: u64,
        room: Room,
        duration_secs: i64,
        ransom_floor: u64,
        ransom_slope: u64,
    ) -> Result<()> {
        require!(room.is_live(), SinError::RoomNotLive);
        require!(duration_secs > 0, SinError::ExpiryInPast);

        let now = Clock::get()?.unix_timestamp;

        // Float for ER-side rent: the market's own permission, the secret's
        // permission, and one ephemeral account + permission per bidder.
        system_transfer(
            CpiContext::new(
                ctx.accounts.system_program.key(),
                SystemTransfer {
                    from: ctx.accounts.author.to_account_info(),
                    to: ctx.accounts.market.to_account_info(),
                },
            ),
            ephemeral_rollups_sdk::ephemeral_accounts::rent(
                EphemeralPermission::size_of(MAX_BIDDERS + 2) as u32,
            )
            .checked_add(SPONSOR_FLOAT)
            .ok_or(SinError::MathOverflow)?,
        )?;

        let market = &mut ctx.accounts.market;
        market.village = ctx.accounts.village.key();
        market.market_id = market_id;
        market.author = ctx.accounts.author.key();
        market.room = room;
        market.commitment_hash = [0u8; 32];
        market.created_at = now;
        market.expires_at = now
            .checked_add(duration_secs)
            .ok_or(SinError::MathOverflow)?;
        market.seal_pot = 0;
        market.read_pot = 0;
        market.yes_pot = 0;
        market.no_pot = 0;
        market.ransom_floor = ransom_floor;
        market.ransom_slope = ransom_slope;
        market.bid_count = 0;
        market.closed_bid_count = 0;
        market.read_bid_count = 0;
        market.status = MarketStatus::Open;
        market.outcome = Outcome::Pending;
        market.sole_reader = Pubkey::default();
        market.randomness = 0;
        market.resolved_at = 0;
        market.escrow_lamports = 0;
        market.author_payout = 0;
        market.rumor_result = 0;
        market.tombstoned = false;
        market.revealed_len = 0;
        market.revealed = [0u8; MAX_TOMB_BODY];
        market.bump = ctx.bumps.market;

        let village = &mut ctx.accounts.village;
        village.market_count = village.market_count.saturating_add(1);

        msg!(
            "Market {} ({:?}) open until {}",
            market.key(),
            room,
            market.expires_at
        );
        Ok(())
    }

    /// Allocate the secret account **empty**.
    ///
    /// This is the whole privacy trick: the account is created on L1 with a zeroed
    /// body, delegated to the TEE, and only then filled in by `seal_secret` on the
    /// ER. No confession byte is ever submitted in a base-layer transaction, so
    /// there is no block, log, or explorer view in which it could appear.
    pub fn create_secret_shell(ctx: Context<CreateSecretShell>, _market_id: u64) -> Result<()> {
        let secret = &mut ctx.accounts.secret;
        secret.market = ctx.accounts.market.key();
        secret.author = ctx.accounts.author.key();
        secret.salt = [0u8; 32];
        secret.body_len = 0;
        secret.body = [0u8; MAX_BODY_LEN];
        secret.redacted_len = 0;
        secret.redacted = [0u8; MAX_REDACTED_LEN];
        secret.bump = ctx.bumps.secret;
        msg!("Secret shell {} allocated empty", secret.key());
        Ok(())
    }

    /// Delegate the market to the ER so bidding is real-time.
    pub fn delegate_market(ctx: Context<DelegateMarket>, market_id: u64) -> Result<()> {
        let village = ctx.accounts.village.key();
        let id_bytes = market_id.to_le_bytes();
        ctx.accounts.delegate_market(
            &ctx.accounts.author,
            &[MARKET_SEED, village.as_ref(), &id_bytes],
            DelegateConfig {
                validator: ctx.accounts.validator.as_ref().map(|v| v.key()),
                ..Default::default()
            },
        )?;
        Ok(())
    }

    /// Delegate the (still empty) secret to the TEE validator.
    pub fn delegate_secret(ctx: Context<DelegateSecret>, _market_id: u64) -> Result<()> {
        // Still ours at this point, so the shell's author can be verified before the
        // delegation program takes ownership.
        {
            let shell: Secret = read_account(&ctx.accounts.secret.to_account_info())?;
            require_keys_eq!(shell.author, ctx.accounts.author.key(), SinError::NotAuthor);
        }
        let market = ctx.accounts.market.key();
        ctx.accounts.delegate_secret(
            &ctx.accounts.author,
            &[SECRET_SEED, market.as_ref()],
            DelegateConfig {
                validator: ctx.accounts.validator.as_ref().map(|v| v.key()),
                ..Default::default()
            },
        )?;
        Ok(())
    }

    /// Fund a villager's purse with real SOL on the base layer.
    pub fn deposit_purse(ctx: Context<DepositPurse>, amount: u64) -> Result<()> {
        require!(amount > 0, SinError::InvalidAmount);
        system_transfer(
            CpiContext::new(
                ctx.accounts.system_program.key(),
                SystemTransfer {
                    from: ctx.accounts.owner.to_account_info(),
                    to: ctx.accounts.purse.to_account_info(),
                },
            ),
            amount,
        )?;
        let purse = &mut ctx.accounts.purse;
        purse.owner = ctx.accounts.owner.key();
        purse.available = purse
            .available
            .checked_add(amount)
            .ok_or(SinError::MathOverflow)?;
        purse.bump = ctx.bumps.purse;
        msg!("Purse {} funded with {} lamports", purse.key(), amount);
        Ok(())
    }

    /// Delegate the purse so its lamports can move at ER speed.
    pub fn delegate_purse(ctx: Context<DelegatePurse>) -> Result<()> {
        let owner = ctx.accounts.owner.key();
        ctx.accounts.delegate_purse(
            &ctx.accounts.owner,
            &[PURSE_SEED, owner.as_ref()],
            DelegateConfig {
                validator: ctx.accounts.validator.as_ref().map(|v| v.key()),
                ..Default::default()
            },
        )?;
        Ok(())
    }

    /// Withdraw from an undelegated purse back to the wallet.
    pub fn withdraw_purse(ctx: Context<WithdrawPurse>, amount: u64) -> Result<()> {
        require!(amount > 0, SinError::InvalidAmount);
        let purse = &mut ctx.accounts.purse;
        require!(purse.locked == 0, SinError::PurseLocked);
        require!(purse.available >= amount, SinError::InsufficientFunds);
        purse.available = purse.available - amount;

        **purse.to_account_info().try_borrow_mut_lamports()? = purse
            .to_account_info()
            .lamports()
            .checked_sub(amount)
            .ok_or(SinError::MathOverflow)?;
        **ctx.accounts.owner.to_account_info().try_borrow_mut_lamports()? = ctx
            .accounts
            .owner
            .to_account_info()
            .lamports()
            .checked_add(amount)
            .ok_or(SinError::MathOverflow)?;
        Ok(())
    }

    /// Carve the verdict into the graveyard on Solana.
    ///
    /// Runs on the base layer against the committed, undelegated market. Plaintext
    /// is copied out of `market.revealed`, which `finalize_market` only ever fills
    /// when `outcome.reveals_text()` is true.
    pub fn write_tombstone(ctx: Context<WriteTombstone>, _market_id: u64) -> Result<()> {
        let market = &ctx.accounts.market;
        require!(
            market.status == MarketStatus::Settled,
            SinError::NotSettled
        );
        require!(!market.tombstoned, SinError::AlreadyTombstoned);

        let tomb = &mut ctx.accounts.tombstone;
        tomb.market = market.key();
        tomb.market_id = market.market_id;
        tomb.author = market.author;
        tomb.room = market.room;
        tomb.commitment_hash = market.commitment_hash;
        tomb.outcome = market.outcome;
        tomb.seal_pot = market.seal_pot;
        tomb.read_pot = market.read_pot;
        tomb.sole_reader = market.sole_reader;
        tomb.randomness = market.randomness;
        tomb.buried_at = Clock::get()?.unix_timestamp;
        tomb.bump = ctx.bumps.tombstone;

        // Defense in depth: even if `revealed` were somehow non-empty, an outcome
        // that does not authorise text publishes the hash alone.
        if market.outcome.reveals_text() {
            tomb.revealed_len = market.revealed_len;
            tomb.revealed = market.revealed;
        } else {
            tomb.revealed_len = 0;
            tomb.revealed = [0u8; MAX_TOMB_BODY];
        }

        let market_key = market.key();
        let outcome = market.outcome;
        ctx.accounts.market.tombstoned = true;
        msg!("Tombstone for market {} outcome {:?}", market_key, outcome);
        Ok(())
    }

    /// Pay the author whatever the village forfeited to them, from the settled
    /// (undelegated) market PDA.
    pub fn claim_author(ctx: Context<ClaimAuthor>, _market_id: u64) -> Result<()> {
        let amount = ctx.accounts.market.author_payout;
        require!(amount > 0, SinError::NothingToClaim);
        require!(
            ctx.accounts.market.status == MarketStatus::Settled,
            SinError::NotSettled
        );

        let market_ai = ctx.accounts.market.to_account_info();
        **market_ai.try_borrow_mut_lamports()? = market_ai
            .lamports()
            .checked_sub(amount)
            .ok_or(SinError::MathOverflow)?;
        **ctx.accounts.author.to_account_info().try_borrow_mut_lamports()? = ctx
            .accounts
            .author
            .to_account_info()
            .lamports()
            .checked_add(amount)
            .ok_or(SinError::MathOverflow)?;

        let market = &mut ctx.accounts.market;
        market.author_payout = 0;
        market.escrow_lamports = market.escrow_lamports.saturating_sub(amount);
        Ok(())
    }

    // =====================================================================
    // EPHEMERAL ROLLUP — permissions
    // =====================================================================

    /// The market's permission is deliberately PUBLIC. Hash, timer, pots and
    /// status are supposed to be readable by anyone; that is the market.
    pub fn init_market_permission(ctx: Context<MarketPermission>, market_id: u64) -> Result<()> {
        require_eq!(ctx.accounts.market.market_id, market_id);
        if ctx.accounts.permission.lamports() > 0 {
            msg!("Market permission already exists");
            return Ok(());
        }
        let id_bytes = ctx.accounts.market.market_id.to_le_bytes();
        let bump = [ctx.accounts.market.bump];
        let signers: &[&[u8]] = &[
            MARKET_SEED,
            ctx.accounts.market.village.as_ref(),
            &id_bytes,
            &bump,
        ];
        CreateEphemeralPermissionCpi {
            payer: ctx.accounts.market.to_account_info(),
            permissioned_account: ctx.accounts.market.to_account_info(),
            permission: ctx.accounts.permission.to_account_info(),
            vault: ctx.accounts.ephemeral_vault.to_account_info(),
            magic_program: ctx.accounts.magic_program.to_account_info(),
            permission_program: ctx.accounts.permission_program.to_account_info(),
            args: EphemeralMembersArgs {
                is_private: false,
                members: vec![permission_member(ctx.accounts.market.author)],
            },
        }
        .invoke_signed(&[signers])?;
        Ok(())
    }

    /// The secret's permission. PRIVATE for confession rooms — member list is
    /// `[author]`, so no other key can read the body over any RPC, TEE endpoint
    /// included. Whisper IPO passes `is_private = false` because a rumor is meant
    /// to be read; it is the positions that stay hidden.
    pub fn init_secret_permission(ctx: Context<SecretPermission>, market_id: u64) -> Result<()> {
        require_eq!(ctx.accounts.market.market_id, market_id);
        if ctx.accounts.permission.lamports() > 0 {
            msg!("Secret permission already exists");
            return Ok(());
        }
        let is_private = ctx.accounts.market.room.is_confession_market();

        let id_bytes = ctx.accounts.market.market_id.to_le_bytes();
        let market_bump = [ctx.accounts.market.bump];
        let market_signers: &[&[u8]] = &[
            MARKET_SEED,
            ctx.accounts.market.village.as_ref(),
            &id_bytes,
            &market_bump,
        ];
        let market_key = ctx.accounts.market.key();
        let secret_bump = [ctx.accounts.secret.bump];
        let secret_signers: &[&[u8]] = &[SECRET_SEED, market_key.as_ref(), &secret_bump];

        CreateEphemeralPermissionCpi {
            payer: ctx.accounts.market.to_account_info(),
            permissioned_account: ctx.accounts.secret.to_account_info(),
            permission: ctx.accounts.permission.to_account_info(),
            vault: ctx.accounts.ephemeral_vault.to_account_info(),
            magic_program: ctx.accounts.magic_program.to_account_info(),
            permission_program: ctx.accounts.permission_program.to_account_info(),
            args: EphemeralMembersArgs {
                is_private,
                members: vec![permission_member(ctx.accounts.secret.author)],
            },
        }
        .invoke_signed(&[market_signers, secret_signers])?;
        msg!("Secret permission created, is_private={}", is_private);
        Ok(())
    }

    /// Write the confession into the TEE.
    ///
    /// Runs on the ER only. `commitment_hash = sha256(body || salt)` is published
    /// to the public market so any later reveal is verifiable, while the body and
    /// the salt never leave the private account.
    pub fn seal_secret(
        ctx: Context<SealSecret>,
        _market_id: u64,
        body: Vec<u8>,
        salt: [u8; 32],
        redacted: Vec<u8>,
    ) -> Result<()> {
        require!(
            !body.is_empty() && body.len() <= MAX_BODY_LEN,
            SinError::InvalidBodyLength
        );
        require!(
            redacted.len() <= MAX_REDACTED_LEN,
            SinError::InvalidRedactionLength
        );
        require!(
            ctx.accounts.market.status == MarketStatus::Open,
            SinError::MarketNotOpen
        );
        require_keys_eq!(
            ctx.accounts.author.key(),
            ctx.accounts.secret.author,
            SinError::NotAuthor
        );

        let digest = hashv(&[body.as_slice(), salt.as_slice()]).to_bytes();

        let secret = &mut ctx.accounts.secret;
        secret.salt = salt;
        secret.body = [0u8; MAX_BODY_LEN];
        secret.body[..body.len()].copy_from_slice(&body);
        secret.body_len = body.len() as u16;
        secret.redacted = [0u8; MAX_REDACTED_LEN];
        secret.redacted[..redacted.len()].copy_from_slice(&redacted);
        secret.redacted_len = redacted.len() as u16;

        ctx.accounts.market.commitment_hash = digest;

        // Deliberately does not log the body. ER transaction logs are gated by the
        // permission's TX_LOGS_FLAG, but the body has no business in a log either way.
        msg!("Secret sealed. commitment={}", hex32(&digest));
        Ok(())
    }

    /// Grant the VRF-selected reader membership of the secret's private permission.
    ///
    /// This is the moment the randomness becomes real: one key, and only one, gains
    /// the ability to decrypt-by-authorisation. The author stays a member.
    pub fn grant_reader(ctx: Context<GrantReader>, market_id: u64) -> Result<()> {
        require_eq!(ctx.accounts.market.market_id, market_id);
        require!(
            matches!(
                ctx.accounts.market.outcome,
                Outcome::SoleReader | Outcome::Inherited
            ),
            SinError::RevealNotAuthorised
        );
        require!(
            ctx.accounts.market.sole_reader != Pubkey::default(),
            SinError::NotResolved
        );

        let id_bytes = ctx.accounts.market.market_id.to_le_bytes();
        let market_bump = [ctx.accounts.market.bump];
        let market_signers: &[&[u8]] = &[
            MARKET_SEED,
            ctx.accounts.market.village.as_ref(),
            &id_bytes,
            &market_bump,
        ];
        let market_key = ctx.accounts.market.key();
        let secret_bump = [ctx.accounts.secret.bump];
        let secret_signers: &[&[u8]] = &[SECRET_SEED, market_key.as_ref(), &secret_bump];

        let members = vec![
            permission_member(ctx.accounts.secret.author),
            permission_member(ctx.accounts.market.sole_reader),
        ];

        UpdateEphemeralPermissionCpi {
            payer: ctx.accounts.market.to_account_info(),
            permissioned_account: ctx.accounts.secret.to_account_info(),
            permission: ctx.accounts.permission.to_account_info(),
            vault: ctx.accounts.ephemeral_vault.to_account_info(),
            magic_program: ctx.accounts.magic_program.to_account_info(),
            permission_program: ctx.accounts.permission_program.to_account_info(),
            authority: ctx.accounts.secret.to_account_info(),
            authority_is_signer: false,
            args: EphemeralMembersArgs {
                is_private: true,
                members,
            },
        }
        .invoke_signed(&[market_signers, secret_signers])?;

        msg!(
            "Sole reader {} admitted to secret {}",
            ctx.accounts.market.sole_reader,
            ctx.accounts.secret.key()
        );
        Ok(())
    }

    // =====================================================================
    // EPHEMERAL ROLLUP — sessions and bidding
    // =====================================================================

    /// Mint a scoped session key so a villager can bid repeatedly without a wallet
    /// popup per click. Scope is a single market, a spend ceiling, and an expiry —
    /// all enforced by the program, not by the client.
    pub fn open_session(
        ctx: Context<OpenSession>,
        _market_id: u64,
        ttl_secs: i64,
        max_spend: u64,
        session_key: Pubkey,
    ) -> Result<()> {
        require!(ttl_secs > 0, SinError::ExpiryInPast);
        require!(max_spend > 0, SinError::InvalidAmount);

        ctx.accounts
            .init_if_needed_ephemeral_session((8 + SessionScope::LEN) as u32)?;

        let now = Clock::get()?.unix_timestamp;
        let scope = SessionScope {
            owner: ctx.accounts.owner.key(),
            session_key,
            market: ctx.accounts.market.key(),
            expires_at: now.checked_add(ttl_secs).ok_or(SinError::MathOverflow)?,
            max_spend,
            spent: 0,
            revoked: false,
            bump: ctx.bumps.session,
        };
        write_account(&ctx.accounts.session.to_account_info(), &scope)?;
        msg!(
            "Session {} scoped to market {} until {}",
            session_key,
            scope.market,
            scope.expires_at
        );
        Ok(())
    }

    /// Revoke a session key immediately.
    pub fn revoke_session(ctx: Context<RevokeSession>, _market_id: u64) -> Result<()> {
        let mut scope: SessionScope = read_account(&ctx.accounts.session.to_account_info())?;
        require_keys_eq!(scope.owner, ctx.accounts.owner.key(), SinError::NotAuthor);
        scope.revoked = true;
        write_account(&ctx.accounts.session.to_account_info(), &scope)?;
        Ok(())
    }

    /// Open a bid. Runs entirely on the ER, signed by the villager's own wallet.
    ///
    /// This instruction only *creates and records* the bid; `fund_bid` moves the
    /// money. They are deliberately separate instructions sent in ONE transaction.
    ///
    /// The reason is a hard runtime rule, learned the hard way: an instruction that
    /// CPIs the magic program for an ephemeral account **and** moves lamports itself
    /// fails with `UnbalancedInstruction` ("sum of account balances before and after
    /// instruction do not match"). The magic program settles its rent outside the
    /// instruction's own accounting, so the runtime's balance check sees the
    /// program's transfer as unmatched. Every place in SINBAZAAR that needs both is
    /// split the same way — see `settle_bid` / `close_bid`. The transaction stays
    /// atomic, so a bid is still opened and funded together or not at all.
    ///
    /// A bid that is created but never funded counts for nothing: it stays
    /// `funded = false`, contributes to no pot, and settles for zero.
    pub fn place_bid(
        ctx: Context<PlaceBid>,
        _market_id: u64,
        side: BidSide,
        amount: u64,
    ) -> Result<()> {
        require_keys_eq!(
            ctx.accounts.signer.key(),
            ctx.accounts.bidder.key(),
            SinError::InvalidSession
        );
        check_biddable(&ctx.accounts.market, side, amount)?;
        require_keys_eq!(
            ctx.accounts.purse.owner,
            ctx.accounts.bidder.key(),
            SinError::InvalidBid
        );
        require!(
            ctx.accounts.purse.available >= amount,
            SinError::InsufficientFunds
        );

        ctx.accounts.create_ephemeral_bid((8 + Bid::LEN) as u32)?;
        record_bid(
            &mut ctx.accounts.market,
            &ctx.accounts.bid.to_account_info(),
            ctx.accounts.bidder.key(),
            side,
            amount,
            ctx.bumps.bid,
        )
    }

    /// The same bid, signed by a scoped session key instead of the wallet.
    ///
    /// A separate instruction rather than an optional account, because the session
    /// scope has to be *written* (to charge the bid against its ceiling) and the ER
    /// rejects a writable account that is not delegated — so the wallet-signed path
    /// must not carry a writable session account it never uses.
    pub fn place_bid_with_session(
        ctx: Context<PlaceBidWithSession>,
        _market_id: u64,
        side: BidSide,
        amount: u64,
    ) -> Result<()> {
        check_biddable(&ctx.accounts.market, side, amount)?;
        require_keys_eq!(
            ctx.accounts.purse.owner,
            ctx.accounts.bidder.key(),
            SinError::InvalidBid
        );
        require!(
            ctx.accounts.purse.available >= amount,
            SinError::InsufficientFunds
        );

        charge_session(
            &ctx.accounts.signer,
            &ctx.accounts.bidder,
            &ctx.accounts.session,
            &ctx.accounts.market.key(),
            amount,
            Clock::get()?.unix_timestamp,
            ctx.program_id,
        )?;

        ctx.accounts.create_ephemeral_bid((8 + Bid::LEN) as u32)?;
        record_bid(
            &mut ctx.accounts.market,
            &ctx.accounts.bid.to_account_info(),
            ctx.accounts.bidder.key(),
            side,
            amount,
            ctx.bumps.bid,
        )
    }

    /// Move the money for a bid that `place_bid` just opened.
    ///
    /// Lamports go purse -> market between two program-owned delegated PDAs, so
    /// there is no base-layer transaction and no wallet round trip. Sent in the
    /// same transaction as `place_bid`; see that instruction for why they are split.
    pub fn fund_bid(ctx: Context<FundBid>, _market_id: u64) -> Result<()> {
        require!(
            ctx.accounts.market.status == MarketStatus::Open,
            SinError::MarketNotOpen
        );

        let mut bid: Bid = read_account(&ctx.accounts.bid.to_account_info())?;
        require_keys_eq!(
            bid.market,
            ctx.accounts.market.key(),
            SinError::InvalidBid
        );
        require_keys_eq!(
            bid.bidder,
            ctx.accounts.purse.owner,
            SinError::InvalidBid
        );
        require!(!bid.funded, SinError::BidAlreadySettled);
        let amount = bid.amount;

        {
            let purse = &mut ctx.accounts.purse;
            require!(purse.available >= amount, SinError::InsufficientFunds);
            purse.available -= amount;
            purse.locked = purse
                .locked
                .checked_add(amount)
                .ok_or(SinError::MathOverflow)?;
        }
        move_lamports(
            &ctx.accounts.purse.to_account_info(),
            &ctx.accounts.market.to_account_info(),
            amount,
        )?;

        bid.funded = true;
        if bid.side == BidSide::Read {
            bid.read_rank = ctx.accounts.market.read_bid_count;
        }
        write_account(&ctx.accounts.bid.to_account_info(), &bid)?;

        let side = bid.side;
        let market = &mut ctx.accounts.market;
        market.escrow_lamports = market
            .escrow_lamports
            .checked_add(amount)
            .ok_or(SinError::MathOverflow)?;
        match side {
            BidSide::Seal => {
                market.seal_pot = market
                    .seal_pot
                    .checked_add(amount)
                    .ok_or(SinError::MathOverflow)?
            }
            BidSide::Read => {
                market.read_pot = market
                    .read_pot
                    .checked_add(amount)
                    .ok_or(SinError::MathOverflow)?;
                market.read_bid_count = market.read_bid_count.saturating_add(1);
            }
            BidSide::Yes => {
                market.yes_pot = market
                    .yes_pot
                    .checked_add(amount)
                    .ok_or(SinError::MathOverflow)?
            }
            BidSide::No => {
                market.no_pot = market
                    .no_pot
                    .checked_add(amount)
                    .ok_or(SinError::MathOverflow)?
            }
        }
        msg!(
            "Bid funded. seal_pot={} read_pot={} yes={} no={}",
            market.seal_pot,
            market.read_pot,
            market.yes_pot,
            market.no_pot
        );
        Ok(())
    }

    /// Hide the bid behind a private permission listing only the bidder.
    pub fn init_bid_permission(ctx: Context<InitBidPermission>, _market_id: u64) -> Result<()> {
        require_keys_eq!(
            ctx.accounts.bid.market,
            ctx.accounts.market.key(),
            SinError::InvalidBid
        );
        if !ctx.accounts.bid_permission.data_is_empty() {
            msg!("Bid permission already exists");
            return Ok(());
        }

        let id_bytes = ctx.accounts.market.market_id.to_le_bytes();
        let market_bump = [ctx.accounts.market.bump];
        let market_signers: &[&[u8]] = &[
            MARKET_SEED,
            ctx.accounts.market.village.as_ref(),
            &id_bytes,
            &market_bump,
        ];
        let market_key = ctx.accounts.market.key();
        let bid_bump = [ctx.accounts.bid.bump];
        let bid_signers: &[&[u8]] = &[
            BID_SEED,
            market_key.as_ref(),
            ctx.accounts.bid.bidder.as_ref(),
            &bid_bump,
        ];

        CreateEphemeralPermissionCpi {
            payer: ctx.accounts.market.to_account_info(),
            permissioned_account: ctx.accounts.bid.to_account_info(),
            permission: ctx.accounts.bid_permission.to_account_info(),
            vault: ctx.accounts.ephemeral_vault.to_account_info(),
            magic_program: ctx.accounts.magic_program.to_account_info(),
            permission_program: ctx.accounts.permission_program.to_account_info(),
            args: EphemeralMembersArgs {
                is_private: true,
                members: vec![permission_member(ctx.accounts.bid.bidder)],
            },
        }
        .invoke_signed(&[market_signers, bid_signers])?;
        Ok(())
    }

    // =====================================================================
    // EPHEMERAL ROLLUP — expiry, randomness, resolution
    // =====================================================================

    /// Close the book. Permissionless: anyone may crank this once the timer is up,
    /// so a market cannot be held open by an absent author.
    pub fn expire_market(ctx: Context<ExpireMarket>, market_id: u64) -> Result<()> {
        require_eq!(ctx.accounts.market.market_id, market_id);
        require!(
            ctx.accounts.market.status == MarketStatus::Open,
            SinError::MarketNotOpen
        );
        let now = Clock::get()?.unix_timestamp;
        require!(
            now >= ctx.accounts.market.expires_at,
            SinError::MarketStillOpen
        );

        let market = &mut ctx.accounts.market;
        market.status = MarketStatus::Expired;

        // A market nobody paid to seal and nobody paid to read leaks by default.
        // That is the rule of the bazaar, and it needs no randomness.
        if market.room.is_confession_market() && market.seal_pot == 0 && market.read_pot == 0 {
            market.outcome = Outcome::PublicLeak;
            market.status = MarketStatus::Resolved;
            market.resolved_at = now;
            msg!("Market {} expired unpaid -> PUBLIC_LEAK", market.key());
        } else {
            msg!("Market {} expired, awaiting resolution", market.key());
        }
        Ok(())
    }

    /// Ask MagicBlock VRF for the randomness that decides this market.
    ///
    /// Requested from the ER against the ephemeral queue, so the request and the
    /// callback both land at rollup speed while the market is still delegated.
    pub fn request_resolution_vrf(
        ctx: Context<RequestResolutionVrf>,
        market_id: u64,
        client_seed: u8,
    ) -> Result<()> {
        require_eq!(ctx.accounts.market.market_id, market_id);
        require!(
            ctx.accounts.market.status == MarketStatus::Expired,
            SinError::MarketNotExpired
        );
        require!(
            ctx.accounts.market.outcome == Outcome::Pending,
            SinError::AlreadyResolved
        );
        // Only the confession rooms are decided by randomness. Without this a Whisper
        // IPO could be pushed into VrfPending, where `callback_resolve` rejects it as
        // WrongRoom and `resolve_rumor` can no longer reach it — a permanent lock.
        require!(
            ctx.accounts.market.room.is_confession_market(),
            SinError::WrongRoom
        );

        let ix = create_request_scoped_randomness_ix(RequestRandomnessParams {
            payer: ctx.accounts.payer.key(),
            oracle_queue: ctx.accounts.oracle_queue.key(),
            callback_program_id: ID,
            callback_discriminator: instruction::CallbackResolve::DISCRIMINATOR.to_vec(),
            caller_seed: [client_seed; 32],
            accounts_metas: Some(vec![SerializableAccountMeta {
                pubkey: ctx.accounts.market.key(),
                is_signer: false,
                is_writable: true,
            }]),
            ..Default::default()
        });
        ctx.accounts
            .invoke_signed_vrf(&ctx.accounts.payer.to_account_info(), &ix)?;

        ctx.accounts.market.status = MarketStatus::VrfPending;
        msg!("VRF requested for market {}", ctx.accounts.market.key());
        Ok(())
    }

    /// The court delivers.
    ///
    /// `#[vrf_callback]` injects a `vrf_program_identity` signer constrained to
    /// `scoped_vrf_identity(&crate::ID)`, a PDA only the VRF program can sign for —
    /// so no user transaction can forge a verdict.
    ///
    /// The callback only records randomness and picks the outcome *class*. Which
    /// specific villager wins is derived deterministically from that randomness in
    /// `settle_bid`, which keeps this instruction small and its account list fixed.
    pub fn callback_resolve(ctx: Context<CallbackResolve>, randomness: [u8; 32]) -> Result<()> {
        let market = &mut ctx.accounts.market;
        require!(
            market.status == MarketStatus::VrfPending,
            SinError::NotResolved
        );

        let rnd = vrf_sdk::rnd::random_u64(&randomness);
        market.randomness = rnd;
        market.resolved_at = Clock::get()?.unix_timestamp;

        market.outcome = match market.room {
            Room::GuiltMarket => {
                if market.seal_pot > 0 {
                    Outcome::Buried
                } else if market.read_pot > 0 {
                    Outcome::SoleReader
                } else {
                    Outcome::PublicLeak
                }
            }
            Room::BlackmailEscrow => {
                let due = market.ransom_due(market.resolved_at);
                if market.seal_pot >= due && due > 0 {
                    Outcome::Buried
                } else if vrf_sdk::rnd::random_bool(&randomness) {
                    Outcome::RandomReveal
                } else if market.read_bid_count > 0 || market.bid_count > 0 {
                    Outcome::Inherited
                } else {
                    Outcome::PublicLeak
                }
            }
            _ => return err!(SinError::WrongRoom),
        };

        // For outcomes that hand the body to exactly one villager, the randomness
        // selects which one. `settle_bid` verifies the winner against this index.
        market.status = MarketStatus::Resolved;
        msg!(
            "Market {} resolved -> {:?} (randomness {})",
            market.key(),
            market.outcome,
            rnd
        );
        Ok(())
    }

    /// Release a market whose randomness never arrived.
    ///
    /// Permissionless, and only after a grace period, so a stalled oracle cannot
    /// strand escrow. It puts the market back to `Expired` where anyone can request
    /// randomness again — it never decides an outcome itself.
    pub fn retry_vrf(ctx: Context<ExpireMarket>, market_id: u64) -> Result<()> {
        require_eq!(ctx.accounts.market.market_id, market_id);
        require!(
            ctx.accounts.market.status == MarketStatus::VrfPending,
            SinError::NotResolved
        );
        let now = Clock::get()?.unix_timestamp;
        require!(
            now >= ctx.accounts.market.expires_at + VRF_GRACE_SECS,
            SinError::MarketStillOpen
        );
        ctx.accounts.market.status = MarketStatus::Expired;
        msg!("VRF grace elapsed; market {} reopened for a new request", ctx.accounts.market.key());
        Ok(())
    }

    /// Whisper IPO settlement.
    ///
    /// Week-1 uses a village-authority attestation. The signature check is the only
    /// thing that would change to swap in an oracle: the payout path below reads
    /// `rumor_result` and nothing else.
    pub fn resolve_rumor(ctx: Context<ResolveRumor>, market_id: u64, result: u8) -> Result<()> {
        require_eq!(ctx.accounts.market.market_id, market_id);
        require!(
            ctx.accounts.market.room == Room::WhisperIpo,
            SinError::WrongRoom
        );
        require!(result == 1 || result == 2, SinError::InvalidRumorResult);
        require!(
            matches!(
                ctx.accounts.market.status,
                MarketStatus::Open | MarketStatus::Expired
            ),
            SinError::AlreadyResolved
        );
        // Week-1 attestation: the villager who listed the rumor calls it. Swapping in
        // an oracle is a change to this one check — the payout path below reads
        // `rumor_result` and nothing else.
        require_keys_eq!(
            ctx.accounts.resolver.key(),
            ctx.accounts.market.author,
            SinError::NotAuthor
        );

        let market = &mut ctx.accounts.market;
        market.rumor_result = result;
        market.outcome = if result == 1 {
            Outcome::Forgiven
        } else {
            Outcome::Slashed
        };
        market.status = MarketStatus::Resolved;
        market.resolved_at = Clock::get()?.unix_timestamp;
        msg!("Rumor {} resolved -> {:?}", market.key(), market.outcome);
        Ok(())
    }

    /// Settle one bid: pay it, refund it, or forfeit it.
    ///
    /// Money only. `close_bid` then reclaims the ephemeral account and its
    /// permission — a separate instruction because this one moves lamports and that
    /// one CPIs the magic program, and the runtime refuses to see both in one
    /// (`UnbalancedInstruction`). The client sends them together.
    ///
    /// Permissionless — anyone can crank it — because the destination is pinned to
    /// the bidder's own purse and the arithmetic is fixed by the recorded outcome.
    pub fn settle_bid(ctx: Context<SettleBid>, _market_id: u64) -> Result<()> {
        require!(
            ctx.accounts.market.status == MarketStatus::Resolved,
            SinError::NotResolved
        );

        let mut bid: Bid = read_account(&ctx.accounts.bid.to_account_info())?;
        require_keys_eq!(bid.market, ctx.accounts.market.key(), SinError::InvalidBid);
        require_keys_eq!(bid.bidder, ctx.accounts.purse.owner, SinError::InvalidBid);
        require!(!bid.settled, SinError::BidAlreadySettled);

        let market_snapshot: Market = (**ctx.accounts.market).clone();
        let payout = if bid.funded {
            compute_payout(&market_snapshot, &bid)?
        } else {
            0
        };

        // A SoleReader / Inherited winner is the one the randomness landed on.
        if matches!(
            market_snapshot.outcome,
            Outcome::SoleReader | Outcome::Inherited
        ) && is_chosen_bid(&market_snapshot, &bid)
        {
            ctx.accounts.market.sole_reader = bid.bidder;
        }

        if payout > 0 {
            move_lamports(
                &ctx.accounts.market.to_account_info(),
                &ctx.accounts.purse.to_account_info(),
                payout,
            )?;
            let purse = &mut ctx.accounts.purse;
            purse.available = purse
                .available
                .checked_add(payout)
                .ok_or(SinError::MathOverflow)?;
        }

        // Whatever the bidder does not get back belongs to the author.
        let staked = if bid.funded { bid.amount } else { 0 };
        let forfeited = staked.saturating_sub(payout.min(staked));

        {
            let purse = &mut ctx.accounts.purse;
            purse.locked = purse.locked.saturating_sub(staked);
        }

        {
            let market = &mut ctx.accounts.market;
            market.escrow_lamports = market.escrow_lamports.saturating_sub(payout);
            market.author_payout = market
                .author_payout
                .checked_add(forfeited)
                .ok_or(SinError::MathOverflow)?;
        }

        bid.settled = true;
        write_account(&ctx.accounts.bid.to_account_info(), &bid)?;

        msg!("Bid settled, payout {}", payout);
        Ok(())
    }

    /// Reclaim a settled bid: close its private permission, then the ephemeral
    /// account itself. Rent goes back to the market that sponsored it.
    pub fn close_bid(ctx: Context<CloseBid>, _market_id: u64) -> Result<()> {
        let bid: Bid = read_account(&ctx.accounts.bid.to_account_info())?;
        require_keys_eq!(bid.market, ctx.accounts.market.key(), SinError::InvalidBid);
        require!(bid.settled, SinError::NotSettled);

        let id_bytes = ctx.accounts.market.market_id.to_le_bytes();
        let market_bump = [ctx.accounts.market.bump];
        let market_signers: &[&[u8]] = &[
            MARKET_SEED,
            ctx.accounts.market.village.as_ref(),
            &id_bytes,
            &market_bump,
        ];
        let market_key = ctx.accounts.market.key();
        let bid_bump = [bid.bump];
        let bid_signers: &[&[u8]] =
            &[BID_SEED, market_key.as_ref(), bid.bidder.as_ref(), &bid_bump];

        CloseEphemeralPermissionCpi {
            payer: ctx.accounts.market.to_account_info(),
            authority: ctx.accounts.bid.to_account_info(),
            permissioned_account: ctx.accounts.bid.to_account_info(),
            permission: ctx.accounts.bid_permission.to_account_info(),
            vault: ctx.accounts.vault.to_account_info(),
            magic_program: ctx.accounts.magic_program.to_account_info(),
            permission_program: ctx.accounts.permission_program.to_account_info(),
            authority_is_signer: false,
        }
        .invoke_signed(&[market_signers, bid_signers])?;
        ctx.accounts.close_ephemeral_bid()?;

        ctx.accounts.market.closed_bid_count =
            ctx.accounts.market.closed_bid_count.saturating_add(1);
        Ok(())
    }

    /// Mark the market fully settled once every bid has been closed.
    pub fn close_book(ctx: Context<CloseBook>, market_id: u64) -> Result<()> {
        require_eq!(ctx.accounts.market.market_id, market_id);
        require!(
            ctx.accounts.market.status == MarketStatus::Resolved,
            SinError::NotResolved
        );
        require_eq!(
            ctx.accounts.market.closed_bid_count,
            ctx.accounts.market.bid_count,
            SinError::UnsettledBids
        );
        // Every bid is closed, so the only escrow left must be what the author is
        // owed. Checking it here turns "the refunds add up" from an invariant we
        // reasoned about into one the program enforces before it lets the market home.
        require_eq!(
            ctx.accounts.market.escrow_lamports,
            ctx.accounts.market.author_payout,
            SinError::EscrowNotEmpty
        );
        ctx.accounts.market.status = MarketStatus::Settled;
        Ok(())
    }

    /// The last act on the rollup.
    ///
    /// If — and only if — the verdict authorises text, copy it out of the private
    /// secret into the market's public reveal buffer. Then commit and undelegate the
    /// market so Solana receives the tombstone. The secret is never undelegated: a
    /// buried confession stays inside the TEE for good.
    ///
    /// Note the `exit(&crate::ID)` before the intent bundle. `commit_and_undelegate`
    /// hands the account to the delegation program *inside* this instruction, so
    /// Anchor's automatic serialization at instruction exit would then be writing to
    /// an account the program no longer owns (`ExternalAccountDataModified`).
    /// Flushing first is the pattern every official example uses before a commit —
    /// see `counter`, `session-keys` and `rock-paper-scissor` in
    /// magicblock-engine-examples. It only bites for the two verdicts that actually
    /// write bytes, which is exactly the public-leak path, so it is easy to miss.
    pub fn finalize_market(ctx: Context<FinalizeMarket>, market_id: u64) -> Result<()> {
        require_eq!(ctx.accounts.market.market_id, market_id);
        require!(
            ctx.accounts.market.status == MarketStatus::Settled,
            SinError::NotSettled
        );

        let outcome = ctx.accounts.market.outcome;
        match outcome {
            Outcome::PublicLeak => {
                let len = ctx.accounts.secret.body_len as usize;
                let body = ctx.accounts.secret.body;
                let market = &mut ctx.accounts.market;
                market.revealed = [0u8; MAX_TOMB_BODY];
                market.revealed[..len].copy_from_slice(&body[..len]);
                market.revealed_len = len as u16;
                msg!("PUBLIC_LEAK: {} bytes released to the graveyard", len);
            }
            Outcome::RandomReveal => {
                let len = ctx.accounts.secret.redacted_len as usize;
                let red = ctx.accounts.secret.redacted;
                let market = &mut ctx.accounts.market;
                market.revealed = [0u8; MAX_TOMB_BODY];
                market.revealed[..len].copy_from_slice(&red[..len]);
                market.revealed_len = len as u16;
                msg!("RANDOM_REVEAL: {} redacted bytes released", len);
            }
            _ => {
                // Buried, SoleReader, Inherited, Forgiven, Slashed: the graveyard
                // gets the hash and nothing else.
                let market = &mut ctx.accounts.market;
                market.revealed = [0u8; MAX_TOMB_BODY];
                market.revealed_len = 0;
                msg!("{:?}: nothing published, hash only", outcome);
            }
        }

        // Flush before handing the account away.
        ctx.accounts.market.exit(&crate::ID)?;

        MagicIntentBundleBuilder::new(
            ctx.accounts.payer.to_account_info(),
            ctx.accounts.magic_context.to_account_info(),
            ctx.accounts.magic_program.to_account_info(),
        )
        .commit_and_undelegate(&[ctx.accounts.market.to_account_info()])
        .build_and_invoke()?;
        Ok(())
    }

    /// Manual commit of live market state to Solana without ending the market.
    pub fn commit_market(ctx: Context<CommitMarket>, _market_id: u64) -> Result<()> {
        MagicIntentBundleBuilder::new(
            ctx.accounts.payer.to_account_info(),
            ctx.accounts.magic_context.to_account_info(),
            ctx.accounts.magic_program.to_account_info(),
        )
        .commit(&[ctx.accounts.market.to_account_info()])
        .build_and_invoke()?;
        Ok(())
    }

    /// Return a purse to the base layer so its owner can withdraw real SOL.
    pub fn undelegate_purse(ctx: Context<UndelegatePurse>) -> Result<()> {
        require!(ctx.accounts.purse.locked == 0, SinError::PurseLocked);
        MagicIntentBundleBuilder::new(
            ctx.accounts.payer.to_account_info(),
            ctx.accounts.magic_context.to_account_info(),
            ctx.accounts.magic_program.to_account_info(),
        )
        .commit_and_undelegate(&[ctx.accounts.purse.to_account_info()])
        .build_and_invoke()?;
        Ok(())
    }
}

// =========================================================================
// helpers
// =========================================================================

fn permission_member(pubkey: Pubkey) -> Member {
    Member {
        flags: AUTHORITY_FLAG | TX_LOGS_FLAG | TX_MESSAGE_FLAG | TX_BALANCES_FLAG,
        pubkey,
    }
}

fn write_account<T: AccountSerialize>(info: &AccountInfo, value: &T) -> Result<()> {
    let mut data = info.try_borrow_mut_data()?;
    value.try_serialize(&mut &mut data[..])?;
    Ok(())
}

fn read_account<T: AccountDeserialize>(info: &AccountInfo) -> Result<T> {
    let data = info.try_borrow_data()?;
    let mut cursor = &data[..];
    T::try_deserialize(&mut cursor)
}

/// Move lamports between two accounts this program owns. Valid on the ER because
/// a delegated account is owned by its original program there.
fn move_lamports<'info>(
    from: &AccountInfo<'info>,
    to: &AccountInfo<'info>,
    amount: u64,
) -> Result<()> {
    let from_balance = from.lamports();
    require!(from_balance >= amount, SinError::InsufficientFunds);
    **from.try_borrow_mut_lamports()? = from_balance
        .checked_sub(amount)
        .ok_or(SinError::MathOverflow)?;
    **to.try_borrow_mut_lamports()? = to
        .lamports()
        .checked_add(amount)
        .ok_or(SinError::MathOverflow)?;
    Ok(())
}

/// Shared preconditions for opening a bid, whoever signed for it.
fn check_biddable(market: &Market, side: BidSide, amount: u64) -> Result<()> {
    require!(amount > 0, SinError::InvalidAmount);
    require!(market.status == MarketStatus::Open, SinError::MarketNotOpen);
    require!(
        Clock::get()?.unix_timestamp < market.expires_at,
        SinError::MarketNotOpen
    );
    require!(
        (market.bid_count as usize) < MAX_BIDDERS,
        SinError::TooManyBidders
    );
    let side_ok = match market.room {
        Room::WhisperIpo => matches!(side, BidSide::Yes | BidSide::No),
        _ => matches!(side, BidSide::Seal | BidSide::Read),
    };
    require!(side_ok, SinError::InvalidBidSide);
    Ok(())
}

/// Write the bid record and count it. `read_rank` is left unset here; `fund_bid`
/// assigns it where `read_bid_count` actually advances.
fn record_bid(
    market: &mut Account<Market>,
    bid_info: &AccountInfo,
    bidder: Pubkey,
    side: BidSide,
    amount: u64,
    bump: u8,
) -> Result<()> {
    let index = market.bid_count;
    let bid = Bid {
        market: market.key(),
        bidder,
        side,
        amount,
        index,
        read_rank: u8::MAX,
        funded: false,
        settled: false,
        bump,
    };
    write_account(bid_info, &bid)?;
    market.bid_count = index + 1;
    msg!("Bid {} opened, awaiting funding", index);
    Ok(())
}

/// Validate a session key against the scope its owner consented to, and charge the
/// bid against its ceiling. The scope is checked here, in the program, not by the client.
fn charge_session<'info>(
    signer: &Signer<'info>,
    bidder: &UncheckedAccount<'info>,
    session: &UncheckedAccount<'info>,
    market: &Pubkey,
    amount: u64,
    now: i64,
    program_id: &Pubkey,
) -> Result<()> {
    // The account must be ours, at the expected address, in scope.
    require!(
        session.owner == program_id && !session.data_is_empty(),
        SinError::InvalidSession
    );
    let expected = Pubkey::find_program_address(
        &[SESSION_SEED, market.as_ref(), bidder.key.as_ref()],
        program_id,
    )
    .0;
    require_keys_eq!(session.key(), expected, SinError::InvalidSession);

    let mut scope: SessionScope = read_account(&session.to_account_info())?;
    require!(
        scope.is_valid(now, market, &signer.key()) && scope.owner == bidder.key(),
        SinError::InvalidSession
    );
    let spent = scope
        .spent
        .checked_add(amount)
        .ok_or(SinError::MathOverflow)?;
    require!(spent <= scope.max_spend, SinError::SessionLimitExceeded);
    scope.spent = spent;
    write_account(&session.to_account_info(), &scope)?;
    Ok(())
}

/// Is this the bid the randomness landed on?
///
/// Selection walks the READ bids in recorded order; `index` is assigned at bid
/// time, so every cranker derives the same winner from the same randomness.
fn is_chosen_bid(market: &Market, bid: &Bid) -> bool {
    match market.outcome {
        Outcome::SoleReader => {
            if market.read_bid_count == 0 || bid.side != BidSide::Read {
                return false;
            }
            let pick = (market.randomness % market.read_bid_count as u64) as u8;
            read_rank(market, bid) == pick
        }
        Outcome::Inherited => {
            if market.bid_count == 0 {
                return false;
            }
            let pick = (market.randomness % market.bid_count as u64) as u8;
            bid.index == pick
        }
        _ => false,
    }
}

/// Rank of a READ bid among READ bids. Bids are indexed in arrival order and the
/// read counter advances in the same order, so rank is derivable from `index`
/// without holding every bid account at once.
fn read_rank(_market: &Market, bid: &Bid) -> u8 {
    bid.read_rank
}

/// What this bid gets back, given the recorded outcome.
fn compute_payout(market: &Market, bid: &Bid) -> Result<u64> {
    let payout = match market.outcome {
        // Silence was bought. Seal bidders paid for it and lose their stake to the
        // author; anyone who bid to read is made whole.
        Outcome::Buried => match bid.side {
            BidSide::Seal => 0,
            _ => bid.amount,
        },
        // Exactly one reader was chosen. They paid for the privilege; everyone else
        // who wanted to read is refunded.
        Outcome::SoleReader => {
            if bid.side == BidSide::Read && is_chosen_bid(market, bid) {
                0
            } else {
                bid.amount
            }
        }
        // The ransom was not met. Seal money goes back — it failed to buy anything.
        // Read money bought the outcome and stays with the author.
        Outcome::RandomReveal | Outcome::Inherited => match bid.side {
            BidSide::Seal => bid.amount,
            _ => 0,
        },
        // Nobody paid, so there is nothing to settle.
        Outcome::PublicLeak => bid.amount,
        // Whisper IPO: winners take their stake plus a pro-rata slice of the losing
        // book; losers take nothing. With no counterparty, everyone is refunded.
        Outcome::Forgiven | Outcome::Slashed => {
            let (win_side, win_pot, lose_pot) = if market.outcome == Outcome::Forgiven {
                (BidSide::Yes, market.yes_pot, market.no_pot)
            } else {
                (BidSide::No, market.no_pot, market.yes_pot)
            };
            if win_pot == 0 {
                bid.amount
            } else if bid.side == win_side {
                let share = (bid.amount as u128)
                    .checked_mul(lose_pot as u128)
                    .ok_or(SinError::MathOverflow)?
                    .checked_div(win_pot as u128)
                    .ok_or(SinError::MathOverflow)?;
                (bid.amount as u128)
                    .checked_add(share)
                    .ok_or(SinError::MathOverflow)? as u64
            } else {
                0
            }
        }
        Outcome::Cancelled => bid.amount,
        _ => bid.amount,
    };
    Ok(payout)
}

/// Short hex of a digest, for logs.
fn hex32(bytes: &[u8; 32]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut out = String::with_capacity(16);
    for b in bytes.iter().take(8) {
        out.push(HEX[(b >> 4) as usize] as char);
        out.push(HEX[(b & 0x0f) as usize] as char);
    }
    out
}

// =========================================================================
// contexts — base layer
// =========================================================================

#[derive(Accounts)]
pub struct InitializeVillage<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(
        init_if_needed,
        payer = authority,
        space = 8 + Village::LEN,
        seeds = [VILLAGE_SEED, authority.key().as_ref()],
        bump
    )]
    pub village: Account<'info, Village>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(market_id: u64)]
pub struct CreateMarket<'info> {
    #[account(mut)]
    pub author: Signer<'info>,
    #[account(mut, seeds = [VILLAGE_SEED, village.authority.as_ref()], bump = village.bump)]
    pub village: Account<'info, Village>,
    #[account(
        init,
        payer = author,
        space = 8 + Market::LEN,
        seeds = [MARKET_SEED, village.key().as_ref(), &market_id.to_le_bytes()],
        bump
    )]
    pub market: Box<Account<'info, Market>>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(market_id: u64)]
pub struct CreateSecretShell<'info> {
    #[account(mut)]
    pub author: Signer<'info>,
    #[account(
        seeds = [MARKET_SEED, market.village.as_ref(), &market_id.to_le_bytes()],
        bump = market.bump,
        constraint = market.author == author.key() @ SinError::NotAuthor
    )]
    pub market: Box<Account<'info, Market>>,
    #[account(
        init,
        payer = author,
        space = 8 + Secret::LEN,
        seeds = [SECRET_SEED, market.key().as_ref()],
        bump
    )]
    pub secret: Box<Account<'info, Secret>>,
    pub system_program: Program<'info, System>,
}

#[delegate]
#[derive(Accounts)]
#[instruction(market_id: u64)]
pub struct DelegateMarket<'info> {
    #[account(mut)]
    pub author: Signer<'info>,
    #[account(seeds = [VILLAGE_SEED, village.authority.as_ref()], bump = village.bump)]
    pub village: Account<'info, Village>,
    /// CHECK: delegated by the delegation program
    #[account(mut, del, seeds = [MARKET_SEED, village.key().as_ref(), &market_id.to_le_bytes()], bump)]
    pub market: UncheckedAccount<'info>,
    /// CHECK: optional target validator
    pub validator: Option<UncheckedAccount<'info>>,
}

#[delegate]
#[derive(Accounts)]
#[instruction(market_id: u64)]
pub struct DelegateSecret<'info> {
    #[account(mut)]
    pub author: Signer<'info>,
    #[account(seeds = [VILLAGE_SEED, village.authority.as_ref()], bump = village.bump)]
    pub village: Account<'info, Village>,
    /// CHECK: the market is normally already delegated by this point, so it is
    /// owned by the delegation program and cannot be deserialized here. Only its
    /// address is needed, and the seeds constraint pins that.
    #[account(seeds = [MARKET_SEED, village.key().as_ref(), &market_id.to_le_bytes()], bump)]
    pub market: UncheckedAccount<'info>,
    /// CHECK: delegated by the delegation program
    #[account(mut, del, seeds = [SECRET_SEED, market.key().as_ref()], bump)]
    pub secret: UncheckedAccount<'info>,
    /// CHECK: optional target validator
    pub validator: Option<UncheckedAccount<'info>>,
}

#[derive(Accounts)]
pub struct DepositPurse<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(
        init_if_needed,
        payer = owner,
        space = 8 + Purse::LEN,
        seeds = [PURSE_SEED, owner.key().as_ref()],
        bump
    )]
    pub purse: Account<'info, Purse>,
    pub system_program: Program<'info, System>,
}

#[delegate]
#[derive(Accounts)]
pub struct DelegatePurse<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    /// CHECK: delegated by the delegation program
    #[account(mut, del, seeds = [PURSE_SEED, owner.key().as_ref()], bump)]
    pub purse: UncheckedAccount<'info>,
    /// CHECK: optional target validator
    pub validator: Option<UncheckedAccount<'info>>,
}

#[derive(Accounts)]
pub struct WithdrawPurse<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(
        mut,
        seeds = [PURSE_SEED, owner.key().as_ref()],
        bump = purse.bump,
        has_one = owner
    )]
    pub purse: Account<'info, Purse>,
}

#[derive(Accounts)]
#[instruction(market_id: u64)]
pub struct WriteTombstone<'info> {
    /// CHECK: permissionless crank; the tombstone content is fixed by market state
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        mut,
        seeds = [MARKET_SEED, market.village.as_ref(), &market_id.to_le_bytes()],
        bump = market.bump
    )]
    pub market: Box<Account<'info, Market>>,
    #[account(
        init,
        payer = payer,
        space = 8 + Tombstone::LEN,
        seeds = [TOMB_SEED, market.key().as_ref()],
        bump
    )]
    pub tombstone: Box<Account<'info, Tombstone>>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(market_id: u64)]
pub struct ClaimAuthor<'info> {
    #[account(mut)]
    pub author: Signer<'info>,
    #[account(
        mut,
        seeds = [MARKET_SEED, market.village.as_ref(), &market_id.to_le_bytes()],
        bump = market.bump,
        constraint = market.author == author.key() @ SinError::NotAuthor
    )]
    pub market: Box<Account<'info, Market>>,
}

// =========================================================================
// contexts — ephemeral rollup
// =========================================================================

#[derive(Accounts)]
#[instruction(market_id: u64)]
pub struct MarketPermission<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        mut,
        seeds = [MARKET_SEED, market.village.as_ref(), &market_id.to_le_bytes()],
        bump = market.bump
    )]
    pub market: Box<Account<'info, Market>>,
    /// CHECK: verified by the permission program
    #[account(
        mut,
        seeds = [PERMISSION_SEED, market.key().as_ref()],
        bump,
        seeds::program = PERMISSION_PROGRAM_ID,
    )]
    pub permission: UncheckedAccount<'info>,
    /// CHECK: fixed permission program id
    #[account(address = PERMISSION_PROGRAM_ID)]
    pub permission_program: UncheckedAccount<'info>,
    /// CHECK: verified by the magic program
    #[account(mut, address = EPHEMERAL_VAULT_ID)]
    pub ephemeral_vault: UncheckedAccount<'info>,
    /// CHECK: fixed magic program id
    #[account(address = MAGIC_PROGRAM_ID)]
    pub magic_program: UncheckedAccount<'info>,
}

#[derive(Accounts)]
#[instruction(market_id: u64)]
pub struct SecretPermission<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        mut,
        seeds = [MARKET_SEED, market.village.as_ref(), &market_id.to_le_bytes()],
        bump = market.bump
    )]
    pub market: Box<Account<'info, Market>>,
    #[account(
        mut,
        seeds = [SECRET_SEED, market.key().as_ref()],
        bump = secret.bump
    )]
    pub secret: Box<Account<'info, Secret>>,
    /// CHECK: verified by the permission program
    #[account(
        mut,
        seeds = [PERMISSION_SEED, secret.key().as_ref()],
        bump,
        seeds::program = PERMISSION_PROGRAM_ID,
    )]
    pub permission: UncheckedAccount<'info>,
    /// CHECK: fixed permission program id
    #[account(address = PERMISSION_PROGRAM_ID)]
    pub permission_program: UncheckedAccount<'info>,
    /// CHECK: verified by the magic program
    #[account(mut, address = EPHEMERAL_VAULT_ID)]
    pub ephemeral_vault: UncheckedAccount<'info>,
    /// CHECK: fixed magic program id
    #[account(address = MAGIC_PROGRAM_ID)]
    pub magic_program: UncheckedAccount<'info>,
}

#[derive(Accounts)]
#[instruction(market_id: u64)]
pub struct SealSecret<'info> {
    #[account(mut)]
    pub author: Signer<'info>,
    #[account(
        mut,
        seeds = [MARKET_SEED, market.village.as_ref(), &market_id.to_le_bytes()],
        bump = market.bump
    )]
    pub market: Box<Account<'info, Market>>,
    #[account(
        mut,
        seeds = [SECRET_SEED, market.key().as_ref()],
        bump = secret.bump
    )]
    pub secret: Box<Account<'info, Secret>>,
}

#[derive(Accounts)]
#[instruction(market_id: u64)]
pub struct GrantReader<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        mut,
        seeds = [MARKET_SEED, market.village.as_ref(), &market_id.to_le_bytes()],
        bump = market.bump
    )]
    pub market: Box<Account<'info, Market>>,
    #[account(
        mut,
        seeds = [SECRET_SEED, market.key().as_ref()],
        bump = secret.bump
    )]
    pub secret: Box<Account<'info, Secret>>,
    /// CHECK: verified by the permission program
    #[account(
        mut,
        seeds = [PERMISSION_SEED, secret.key().as_ref()],
        bump,
        seeds::program = PERMISSION_PROGRAM_ID,
    )]
    pub permission: UncheckedAccount<'info>,
    /// CHECK: fixed permission program id
    #[account(address = PERMISSION_PROGRAM_ID)]
    pub permission_program: UncheckedAccount<'info>,
    /// CHECK: verified by the magic program
    #[account(mut, address = EPHEMERAL_VAULT_ID)]
    pub ephemeral_vault: UncheckedAccount<'info>,
    /// CHECK: fixed magic program id
    #[account(address = MAGIC_PROGRAM_ID)]
    pub magic_program: UncheckedAccount<'info>,
}

#[ephemeral_accounts]
#[derive(Accounts)]
#[instruction(market_id: u64)]
pub struct OpenSession<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(
        mut,
        sponsor,
        seeds = [MARKET_SEED, market.village.as_ref(), &market.market_id.to_le_bytes()],
        bump = market.bump
    )]
    pub market: Account<'info, Market>,
    /// CHECK: ER-only session scope sponsored by the market
    #[account(
        mut,
        eph,
        seeds = [SESSION_SEED, market.key().as_ref(), owner.key().as_ref()],
        bump
    )]
    pub session: UncheckedAccount<'info>,
}

#[derive(Accounts)]
#[instruction(market_id: u64)]
pub struct RevokeSession<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(
        seeds = [MARKET_SEED, market.village.as_ref(), &market_id.to_le_bytes()],
        bump = market.bump
    )]
    pub market: Account<'info, Market>,
    /// CHECK: deserialized and ownership-checked in the handler
    #[account(
        mut,
        owner = crate::ID,
        seeds = [SESSION_SEED, market.key().as_ref(), owner.key().as_ref()],
        bump
    )]
    pub session: UncheckedAccount<'info>,
}

#[ephemeral_accounts]
#[derive(Accounts)]
#[instruction(market_id: u64)]
pub struct PlaceBid<'info> {
    /// The villager, signing for themselves.
    #[account(mut)]
    pub signer: Signer<'info>,
    /// CHECK: must equal `signer`; kept as its own account so both bid paths derive
    /// the bid PDA from the same seeds.
    pub bidder: UncheckedAccount<'info>,
    #[account(
        mut,
        sponsor,
        seeds = [MARKET_SEED, market.village.as_ref(), &market.market_id.to_le_bytes()],
        bump = market.bump
    )]
    pub market: Account<'info, Market>,
    /// CHECK: ER-only bid account sponsored by the market
    #[account(
        mut,
        eph,
        seeds = [BID_SEED, market.key().as_ref(), bidder.key().as_ref()],
        bump
    )]
    pub bid: UncheckedAccount<'info>,
    #[account(
        mut,
        seeds = [PURSE_SEED, bidder.key().as_ref()],
        bump = purse.bump
    )]
    pub purse: Account<'info, Purse>,
}

#[ephemeral_accounts]
#[derive(Accounts)]
#[instruction(market_id: u64)]
pub struct PlaceBidWithSession<'info> {
    /// The session key the villager's wallet authorised.
    #[account(mut)]
    pub signer: Signer<'info>,
    /// CHECK: the villager on whose behalf the bid is placed
    pub bidder: UncheckedAccount<'info>,
    #[account(
        mut,
        sponsor,
        seeds = [MARKET_SEED, market.village.as_ref(), &market.market_id.to_le_bytes()],
        bump = market.bump
    )]
    pub market: Account<'info, Market>,
    /// CHECK: ER-only bid account sponsored by the market
    #[account(
        mut,
        eph,
        seeds = [BID_SEED, market.key().as_ref(), bidder.key().as_ref()],
        bump
    )]
    pub bid: UncheckedAccount<'info>,
    #[account(
        mut,
        seeds = [PURSE_SEED, bidder.key().as_ref()],
        bump = purse.bump
    )]
    pub purse: Account<'info, Purse>,
    /// CHECK: the session scope, deserialized and address-checked in the handler.
    /// Writable because the bid is charged against its spend ceiling.
    #[account(
        mut,
        seeds = [SESSION_SEED, market.key().as_ref(), bidder.key().as_ref()],
        bump
    )]
    pub session: UncheckedAccount<'info>,
}

#[derive(Accounts)]
#[instruction(market_id: u64)]
pub struct FundBid<'info> {
    #[account(mut)]
    pub signer: Signer<'info>,
    #[account(
        mut,
        seeds = [MARKET_SEED, market.village.as_ref(), &market_id.to_le_bytes()],
        bump = market.bump
    )]
    pub market: Box<Account<'info, Market>>,
    /// CHECK: the ephemeral bid opened by `place_bid`; deserialized in the handler
    #[account(
        mut,
        owner = crate::ID,
        seeds = [BID_SEED, market.key().as_ref(), purse.owner.as_ref()],
        bump
    )]
    pub bid: UncheckedAccount<'info>,
    #[account(
        mut,
        seeds = [PURSE_SEED, purse.owner.as_ref()],
        bump = purse.bump
    )]
    pub purse: Box<Account<'info, Purse>>,
}

#[derive(Accounts)]
#[instruction(market_id: u64)]
pub struct InitBidPermission<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        mut,
        seeds = [MARKET_SEED, market.village.as_ref(), &market_id.to_le_bytes()],
        bump = market.bump
    )]
    pub market: Box<Account<'info, Market>>,
    #[account(
        mut,
        seeds = [BID_SEED, market.key().as_ref(), bid.bidder.as_ref()],
        bump = bid.bump
    )]
    pub bid: Box<Account<'info, Bid>>,
    /// CHECK: verified by the permission program
    #[account(mut)]
    pub bid_permission: UncheckedAccount<'info>,
    /// CHECK: fixed permission program id
    #[account(address = PERMISSION_PROGRAM_ID)]
    pub permission_program: UncheckedAccount<'info>,
    /// CHECK: verified by the magic program
    #[account(mut, address = EPHEMERAL_VAULT_ID)]
    pub ephemeral_vault: UncheckedAccount<'info>,
    /// CHECK: fixed magic program id
    #[account(address = MAGIC_PROGRAM_ID)]
    pub magic_program: UncheckedAccount<'info>,
}

#[derive(Accounts)]
#[instruction(market_id: u64)]
pub struct ExpireMarket<'info> {
    /// CHECK: permissionless crank
    #[account(mut)]
    pub cranker: Signer<'info>,
    #[account(
        mut,
        seeds = [MARKET_SEED, market.village.as_ref(), &market_id.to_le_bytes()],
        bump = market.bump
    )]
    pub market: Box<Account<'info, Market>>,
}

#[vrf]
#[derive(Accounts)]
#[instruction(market_id: u64)]
pub struct RequestResolutionVrf<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        mut,
        seeds = [MARKET_SEED, market.village.as_ref(), &market_id.to_le_bytes()],
        bump = market.bump
    )]
    pub market: Box<Account<'info, Market>>,
    /// CHECK: validated by the ephemeral VRF program when it processes the request
    #[account(mut)]
    pub oracle_queue: UncheckedAccount<'info>,
}

#[vrf_callback]
#[derive(Accounts)]
pub struct CallbackResolve<'info> {
    #[account(mut)]
    pub market: Box<Account<'info, Market>>,
}

#[derive(Accounts)]
#[instruction(market_id: u64)]
pub struct ResolveRumor<'info> {
    #[account(mut)]
    pub resolver: Signer<'info>,
    #[account(
        mut,
        seeds = [MARKET_SEED, market.village.as_ref(), &market_id.to_le_bytes()],
        bump = market.bump
    )]
    pub market: Box<Account<'info, Market>>,
}

#[derive(Accounts)]
#[instruction(market_id: u64)]
pub struct SettleBid<'info> {
    /// CHECK: permissionless crank; funds only ever move to the bidder's own purse
    #[account(mut)]
    pub cranker: Signer<'info>,
    #[account(
        mut,
        seeds = [MARKET_SEED, market.village.as_ref(), &market_id.to_le_bytes()],
        bump = market.bump
    )]
    pub market: Box<Account<'info, Market>>,
    /// CHECK: the ephemeral bid; deserialized and address-checked in the handler
    #[account(
        mut,
        owner = crate::ID,
        seeds = [BID_SEED, market.key().as_ref(), purse.owner.as_ref()],
        bump
    )]
    pub bid: UncheckedAccount<'info>,
    #[account(
        mut,
        seeds = [PURSE_SEED, purse.owner.as_ref()],
        bump = purse.bump
    )]
    pub purse: Box<Account<'info, Purse>>,
}

#[ephemeral_accounts]
#[derive(Accounts)]
#[instruction(market_id: u64)]
pub struct CloseBid<'info> {
    /// CHECK: permissionless crank
    #[account(mut)]
    pub cranker: Signer<'info>,
    #[account(
        mut,
        sponsor,
        seeds = [MARKET_SEED, market.village.as_ref(), &market.market_id.to_le_bytes()],
        bump = market.bump
    )]
    pub market: Account<'info, Market>,
    /// CHECK: ER-only bid account sponsored by the market
    #[account(
        mut,
        eph,
        seeds = [BID_SEED, market.key().as_ref(), bidder.key().as_ref()],
        bump
    )]
    pub bid: UncheckedAccount<'info>,
    /// CHECK: the villager whose bid this is; pins the bid PDA
    pub bidder: UncheckedAccount<'info>,
    /// CHECK: verified by the permission program
    #[account(mut)]
    pub bid_permission: UncheckedAccount<'info>,
    /// CHECK: fixed permission program id
    #[account(address = PERMISSION_PROGRAM_ID)]
    pub permission_program: UncheckedAccount<'info>,
}

#[derive(Accounts)]
#[instruction(market_id: u64)]
pub struct CloseBook<'info> {
    /// CHECK: permissionless crank
    #[account(mut)]
    pub cranker: Signer<'info>,
    #[account(
        mut,
        seeds = [MARKET_SEED, market.village.as_ref(), &market_id.to_le_bytes()],
        bump = market.bump
    )]
    pub market: Box<Account<'info, Market>>,
}

#[commit]
#[derive(Accounts)]
#[instruction(market_id: u64)]
pub struct FinalizeMarket<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        mut,
        seeds = [MARKET_SEED, market.village.as_ref(), &market_id.to_le_bytes()],
        bump = market.bump
    )]
    pub market: Box<Account<'info, Market>>,
    #[account(
        seeds = [SECRET_SEED, market.key().as_ref()],
        bump = secret.bump
    )]
    pub secret: Box<Account<'info, Secret>>,
}

#[commit]
#[derive(Accounts)]
#[instruction(market_id: u64)]
pub struct CommitMarket<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        mut,
        seeds = [MARKET_SEED, market.village.as_ref(), &market_id.to_le_bytes()],
        bump = market.bump
    )]
    pub market: Box<Account<'info, Market>>,
}

#[commit]
#[derive(Accounts)]
pub struct UndelegatePurse<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        mut,
        seeds = [PURSE_SEED, purse.owner.as_ref()],
        bump = purse.bump
    )]
    pub purse: Box<Account<'info, Purse>>,
}
