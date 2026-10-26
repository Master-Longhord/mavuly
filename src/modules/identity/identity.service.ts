import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { UpdateProfileDto } from './dto/update-profile.dto';
import * as crypto from 'crypto';

@Injectable()
export class IdentityService {
    constructor(private prisma: PrismaService) { }

    async getProfile(userId: string) {
        const user = await this.prisma.user.findUnique({
            where: { id: userId },
            select: {
                id: true,
                email: true,
                role: true,
                accountType: true,
                name: true,
                studioName: true,
                phone: true,
                country: true,
                dob: true,
                notifications: true,
                legalName: true,
                bankName: true,
                accountNumber: true,
                accountName: true,
                withdrawalVerified: true,
                developerVerified: true,
                coinBalance: true,
                escrowBalance: true,
                createdAt: true,
                isEmailVerified: true,
                referralCode: true,
                businessDocUrl: true,
                idDocUrl: true,
                addressDocUrl: true,
                apiKey: true,
                apiSecret: true,
                postbackUrl: true,
            },
        });

        if (!user) throw new NotFoundException('User profile not found');
        return user;
    }

    async updateProfile(userId: string, dto: UpdateProfileDto) {
        const updateData: any = { ...dto };
        if (dto.dob) {
            updateData.dob = new Date(dto.dob);
        }
        return this.prisma.user.update({
            where: { id: userId },
            data: updateData,
            select: {
                id: true,
                name: true,
                studioName: true,
                phone: true,
                country: true,
                dob: true,
                notifications: true,
            },
        });
    }

    async claimDailyReward(userId: string) {
        const user = await this.prisma.user.findUnique({ where: { id: userId } });
        if (!user) throw new NotFoundException('User not found');

        const today = new Date();
        today.setUTCHours(0, 0, 0, 0);

        if (user.lastDailyClaim) {
            const lastClaimDate = new Date(user.lastDailyClaim);
            lastClaimDate.setUTCHours(0, 0, 0, 0);

            if (lastClaimDate.getTime() === today.getTime()) {
                throw new ForbiddenException('You have already claimed your daily reward today. Come back tomorrow!');
            }
        }

        return this.prisma.$transaction(async (tx) => {
            const updatedUser = await tx.user.update({
                where: { id: userId },
                data: {
                    coinBalance: { increment: 20 },
                    lastDailyClaim: new Date(),
                },
                select: { coinBalance: true, lastDailyClaim: true },
            });

            await tx.transaction.create({
                data: {
                    userId,
                    amount: 20,
                    type: 'REWARD',
                    status: 'COMPLETED',
                    reference: `DAILY-${Date.now()}-${userId}`,
                    description: 'Daily login bonus',
                },
            });

            return {
                message: 'Daily reward claimed successfully!',
                coinsAwarded: 20,
                newBalance: updatedUser.coinBalance,
            };
        });
    }

    // --- WALLET BALANCES (Available, Pending, Lifetime) ---
    async getWalletBalances(userId: string) {
        const user = await this.prisma.user.findUnique({ where: { id: userId } });
        if (!user) throw new NotFoundException('User not found');
        const availableCoins = user.coinBalance;
        const availableUsd = Number(user.escrowBalance || 0);
        const pendingAgg = await this.prisma.transaction.aggregate({
            where: { userId, status: 'PENDING', type: 'WITHDRAWAL' },
            _sum: { amount: true }
        });
        const pendingUsd = Number(pendingAgg._sum?.amount || 0);
        const lifetimeAgg = await this.prisma.transaction.aggregate({
            where: { userId, type: { in: ['REWARD', 'PVP_WIN', 'REFERRAL_BONUS'] }, status: 'COMPLETED' },
            _sum: { amount: true }
        });
        const lifetimeCoins = Number(lifetimeAgg._sum?.amount || 0);

        return {
            availableCoins,
            availableUsd,
            pendingUsd,
            lifetimeCoins
        };
    }

    // --- DAILY QUESTS DEFINITIONS ---
    private readonly QUEST_DEFS = {
        daily_debut: { id: 'daily_debut', title: 'Daily Debut', desc: 'Play 1 match of any game today.', field: 'matchesPlayedToday', target: 1, reward: 15 },
        math_sprint: { id: 'math_sprint', title: 'Math Sprint', desc: 'Complete 2 matches of Math Duel today.', field: 'mathMatchesToday', target: 2, reward: 25 },
        memory_master: { id: 'memory_master', title: 'Memory Master', desc: 'Finish 1 match of Tile Match today.', field: 'tileMatchesToday', target: 1, reward: 20 },
        arcade_champion: { id: 'arcade_champion', title: 'Arcade Champion', desc: 'Play 5 total matches across any game mode.', field: 'matchesPlayedToday', target: 5, reward: 50 },
    };

    async getDailyQuests(userId: string) {
        const user = await this.prisma.user.findUnique({ where: { id: userId } });
        if (!user) throw new NotFoundException('User not found');

        const today = new Date().toISOString().slice(0, 10);

        const activeToday = user.lastStreakDate === today;
        const claimsToday = user.questClaimsDate === today ? user.questClaims : [];

        const quests = Object.values(this.QUEST_DEFS).map((q) => {
            const currentProgress = activeToday ? (user[q.field as keyof typeof user] as number || 0) : 0;
            return {
                id: q.id,
                title: q.title,
                description: q.desc,
                target: q.target,
                reward: q.reward,
                progress: Math.min(currentProgress, q.target),
                isCompleted: currentProgress >= q.target,
                isClaimed: claimsToday.includes(q.id),
            };
        });

        return quests;
    }

    async claimQuest(userId: string, questId: string) {
        const quest = this.QUEST_DEFS[questId as keyof typeof this.QUEST_DEFS];
        if (!quest) throw new BadRequestException('Invalid quest ID');

        return this.prisma.$transaction(async (tx) => {
            const user = await tx.user.findUnique({ where: { id: userId } });
            if (!user) throw new NotFoundException('User not found');

            const today = new Date().toISOString().slice(0, 10);
            const claimsToday = user.questClaimsDate === today ? user.questClaims : [];

            if (claimsToday.includes(questId)) {
                throw new ConflictException('Quest already claimed today.');
            }

            const activeToday = user.lastStreakDate === today;
            const progress = activeToday ? (user[quest.field as keyof typeof user] as number || 0) : 0;

            if (progress < quest.target) {
                throw new BadRequestException('Quest not yet completed.');
            }

            const updatedClaims = user.questClaimsDate === today ? [...user.questClaims, questId] : [questId];

            const updatedUser = await tx.user.update({
                where: { id: userId },
                data: {
                    coinBalance: { increment: quest.reward },
                    questClaimsDate: today,
                    questClaims: updatedClaims,
                },
            });

            await tx.transaction.create({
                data: {
                    userId,
                    amount: quest.reward,
                    type: 'REWARD',
                    status: 'COMPLETED',
                    reference: `QUEST-${questId}-${Date.now()}`,
                    description: `Quest reward: ${quest.title}`,
                },
            });

            return {
                status: 'claimed',
                reward: quest.reward,
                questId,
                newBalance: updatedUser.coinBalance,
            };
        });
    }

    // --- REFERRAL DASHBOARD ---
    async getReferralStats(userId: string) {
        const user = await this.prisma.user.findUnique({
            where: { id: userId },
            include: {
                referrals: {
                    select: { id: true, name: true, createdAt: true, isEmailVerified: true }
                }
            }
        });

        if (!user) throw new NotFoundException('User not found');

        const earningsAgg = await this.prisma.transaction.aggregate({
            where: { userId, type: 'REFERRAL_BONUS', status: 'COMPLETED' },
            _sum: { amount: true }
        });
        const earnings = Number(earningsAgg._sum?.amount || 0);

        const activeReferrals = user.referrals.filter((r) => r.isEmailVerified).length;

        const history = user.referrals.map((r) => ({
            name: r.name,
            date: r.createdAt,
            reward: 100,
            status: r.isEmailVerified ? 'Completed' : 'Pending Verification'
        }));

        return {
            referralCode: user.referralCode,
            totalReferrals: user.referrals.length,
            activeReferrals,
            earnings,
            history
        };
    }

    async getNotifications(userId: string) {
        const notifications = await this.prisma.notification.findMany({
            where: { userId },
            orderBy: { createdAt: 'desc' }
        });

        const unreadCount = notifications.filter(n => !n.isRead).length;

        return { unreadCount, notifications };
    }

    async markNotificationsRead(userId: string) {
        await this.prisma.notification.updateMany({
            where: { userId, isRead: false },
            data: { isRead: true }
        });
        return { message: 'All notifications marked as read' };
    }

    async uploadKybDocuments(userId: string, dto: { businessDocUrl?: string; idDocUrl?: string; addressDocUrl?: string }) {
        const user = await this.prisma.user.findUnique({ where: { id: userId } });
        if (!user || user.accountType !== 'DEVELOPER') {
            throw new ForbiddenException('Only developers can upload KYB documents');
        }

        await this.prisma.user.update({
            where: { id: userId },
            data: {
                businessDocUrl: dto.businessDocUrl || user.businessDocUrl,
                idDocUrl: dto.idDocUrl || user.idDocUrl,
                addressDocUrl: dto.addressDocUrl || user.addressDocUrl,
                // Once they upload an ID, we mark them as Pending Review
                kycStatus: 'PENDING'
            }
        });

        return { message: 'Documents uploaded successfully. Pending admin verification.' };
    }

    // --- DEVELOPER APPS ("My Apps" Tab) ---
    async registerDeveloperApp(developerId: string, dto: { name: string; type: string; version?: string; description?: string }) {
        return this.prisma.developerApp.create({
            data: {
                developerId,
                name: dto.name,
                type: dto.type,
                version: dto.version,
                description: dto.description,
                moderationStatus: 'PENDING',
            }
        });
    }

    async getDeveloperApps(developerId: string) {
        return this.prisma.developerApp.findMany({
            where: { developerId },
            orderBy: { createdAt: 'desc' }
        });
    }

    async generateApiKeys(userId: string) {
        const user = await this.prisma.user.findUnique({ where: { id: userId } });
        if (!user || user.accountType !== 'DEVELOPER') {
            throw new ForbiddenException('Only developers can generate API keys');
        }

        const apiKey = `pk_test_${crypto.randomBytes(16).toString('hex')}`;
        const apiSecret = `sk_test_${crypto.randomBytes(24).toString('hex')}`;

        await this.prisma.user.update({
            where: { id: userId },
            data: { apiKey, apiSecret }
        });

        return {
            message: 'API Keys generated successfully',
            apiKey,
            apiSecret,
            embedSnippet: `<script src="https://mavuly.com/sdk.js" data-api-key="${apiKey}"></script>`
        };
    }

    // --- ADSTERRA AD REFILL ---
    async claimAdRefill(userId: string) {
        const REWARD = 25;

        return this.prisma.$transaction(async (tx) => {
            const user = await tx.user.findUnique({ where: { id: userId } });
            if (!user) throw new NotFoundException('User not found');
            const updatedUser = await tx.user.update({
                where: { id: userId },
                data: {
                    coinBalance: { increment: REWARD },
                    lastAdRefillAt: new Date(),
                },
            });

            await tx.transaction.create({
                data: {
                    userId,
                    amount: REWARD,
                    type: 'REWARD',
                    status: 'COMPLETED',
                    reference: `AD-REFILL-${Date.now()}-${userId}`,
                    description: 'Watched Adsterra Ad Refill',
                },
            });

            return {
                success: true,
                message: 'Ad reward claimed!',
                reward: REWARD,
                newBalance: updatedUser.coinBalance
            };
        });
    }

    async updatePostbackUrl(userId: string, postbackUrl: string) {
        const user = await this.prisma.user.findUnique({ where: { id: userId } });
        if (!user || user.accountType !== 'DEVELOPER') {
            throw new ForbiddenException('Only developers can set a postback URL');
        }

        await this.prisma.user.update({
            where: { id: userId },
            data: { postbackUrl }
        });

        return { message: 'Postback URL saved successfully', postbackUrl };
    }
}