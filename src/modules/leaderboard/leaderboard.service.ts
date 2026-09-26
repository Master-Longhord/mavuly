import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AccountType, Role } from '@prisma/client';

@Injectable()
export class LeaderboardService {
    constructor(private prisma: PrismaService) { }

    async getTopByCoins(limit: number = 50) {
        return this.prisma.user.findMany({
            where: {
                isActive: true,
                role: Role.USER,
                accountType: AccountType.TESTER
            },
            orderBy: { coinBalance: 'desc' },
            take: limit,
            select: {
                id: true,
                name: true,
                coinBalance: true,
            },
        });
    }

    async getTopByStreak(limit: number = 50) {
        return this.prisma.user.findMany({
            where: {
                isActive: true,
                role: Role.USER,
                accountType: AccountType.TESTER
            },
            orderBy: { streakDays: 'desc' },
            take: limit,
            select: {
                id: true,
                name: true,
                streakDays: true,
            },
        });
    }
}