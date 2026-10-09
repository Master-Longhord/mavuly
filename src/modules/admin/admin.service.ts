import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { MatchStatus, TransactionType } from '@prisma/client';

@Injectable()
export class AdminService {
    constructor(private prisma: PrismaService) { }

    async getDashboardStats() {
        const totalUsers = await this.prisma.user.count();

        const liveMatchesCount = await this.prisma.arcadeMatch.count({
            where: {
                status: MatchStatus.PLAYING,
            },
        });

        const platformProfitAggregate = await this.prisma.transaction.aggregate({
            where: {
                type: TransactionType.PLATFORM_PROFIT,
                status: 'COMPLETED',
            },
            _sum: {
                amount: true,
            },
        });
        const totalProfitCoins = Number(platformProfitAggregate._sum.amount || 0);

        const economyAggregate = await this.prisma.user.aggregate({
            _sum: {
                coinBalance: true,
            },
        });
        const totalCoinsInCirculation = Number(economyAggregate._sum.coinBalance || 0);

        return {
            totalUsers,
            liveMatchesCount,
            totalProfitCoins,
            totalCoinsInCirculation,
            totalProfitUsd: totalProfitCoins * 0.001,
        };
    }
}