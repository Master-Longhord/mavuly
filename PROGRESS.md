# Mavuly Backend - Progress Tracker

## 1. Project Foundation & Security ✅
- [x] Scaffold NestJS Monolith.
- [x] Configure Prisma & Cloud PostgreSQL (Neon).
- [x] Define exact Database Schema (schema.prisma).
- [x] Setup Global Prisma Service.
- [x] Implement Global Validation Pipes (DTO enforcement).
- [x] Create Custom Decorators (`@Public()`, `@Roles()`).
- [x] Implement RBAC Guards (`JwtAuthGuard`, `RolesGuard`).

## 2. Authentication Module (`AuthModule`) ✅
- [x] Register endpoint (Argon2 hashing).
- [x] Login endpoint.
- [x] JWT Strategy & Token Generation (Access & Refresh tokens).

## 3. Identity Module (`IdentityModule`) ✅
- [x] Get Current User Profile endpoint (`/api/v1/identity/me`).
- [x] Update Profile endpoint (`PATCH /api/v1/identity/me`).

## 4. Campaigns Module (`CampaignModule`) ⏳ *[Up Next]*
- [ ] Developer Campaign creation (Escrow Allocation).
- [ ] Public active testing catalog (`/api/v1/campaigns/active`).

## 5. Submissions Module (`SubmissionModule`) ❌
- [ ] Tester task reservation & Tracking URL generation.
- [ ] Tester task submission (Screenshots & Surveys).
- [ ] Developer dashboard review view.
- [ ] Quality Review & Escrow Release (Accept/Reject logic).

## 6. Ledger Module (`LedgerModule`) ❌
- [ ] Flutterwave KYC Bank Account Verification.
- [ ] Escrow transaction logging.
- [ ] User transaction logging (Rewards, Platform Profit, Withdrawals).

## 7. Arcade Module (`ArcadeModule`) ❌
- [ ] PvP matchmaking (60s Arcade).
- [ ] Automated duel settlement.