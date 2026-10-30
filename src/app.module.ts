import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler'; // <-- 1. Import Throttler
import { PrismaModule } from './common/prisma/prisma.module';
import { AuthModule } from './modules/auth/auth.module';
import { IdentityModule } from './modules/identity/identity.module';
import { ArcadeModule } from './modules/arcade/arcade.module';
import { LeaderboardModule } from './modules/leaderboard/leaderboard.module';
import { VerificationModule } from './modules/verification/verification.module';
import { LedgerModule } from './modules/ledger/ledger.module';
import { AdminModule } from './modules/admin/admin.module';
import { CampaignsModule } from './modules/campaigns/campaigns.module';
import { SubmissionsModule } from './modules/submissions/submissions.module';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { RolesGuard } from './common/guards/roles.guard';
import { MailModule } from './modules/mail/mail.module';
import { SupportModule } from './modules/support/support.module';
import { MultiplayerModule } from './modules/multiplayer/multiplayer.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ThrottlerModule.forRoot([{
      ttl: 60000,
      limit: 10,
    }]),
    PrismaModule,
    AuthModule,
    IdentityModule,
    ArcadeModule,
    LeaderboardModule,
    VerificationModule,
    LedgerModule,
    AdminModule,
    CampaignsModule,
    SubmissionsModule,
    MailModule,
    SupportModule,
    MultiplayerModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule { }