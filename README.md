# Mavuly Backend API

The core backend architecture for **Mavuly** - a unified gaming (PvP Arcade) and QA marketplace. Built as a secure, scalable Modular Monolith.

## 🚀 Tech Stack
* **Framework:** NestJS (Node.js / TypeScript)
* **Database:** PostgreSQL (Hosted on Neon)
* **ORM:** Prisma
* **Security:** Argon2 (Password Hashing), Passport/JWT (Authentication), Class-Validator (DTO strict validation)
* **Payment & KYC Rails:** Flutterwave

## 🏗️ Architecture (Modular Monolith)
The application strictly follows Domain-Driven Design principles. Modules are heavily encapsulated.
* `AuthModule`: JWT issuance and credentials.
* `IdentityModule`: User profiles, real-time balances, and daily retention rewards.
* `ArcadeModule`: Matchmaking, ACID-compliant wagering, Ghost-Bots, and Anti-Cheat server-side scoring for 4 in-house games.
* `LeaderboardModule`: Global rankings for coins and play streaks.
* `VerificationModule`: Zero-cost KYC via Flutterwave Bank Account Resolution (NIBSS).
* `LedgerModule`: Withdrawals, currency conversions, and automated payouts.

## 💻 Local Setup Instructions

1. **Install dependencies:**
   ```bash
   npm install
Environment Variables: Create a .env file in the root directory and add: code Env DATABASE_URL="postgresql://<user>:<password>@<host>/<db>?sslmode=require* JWT_ACCESS_SECRET=*your-secure-access-secret* JWT_REFRESH_SECRET=*your-secure-refresh-secret* FLUTTERWAVE_SECRET_KEY=*FLWSECK_TEST-your-secret-key-here" Database Migration: Apply the schema to your database: code Bash npx prisma migrate dev Run the Application: code Bash # Development mode (auto-reload) npm run start:dev The **API** will be available at [http://localhost:**3000**/api/v1/.](http://localhost:**3000**/api/v1/.)