import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { UpdateProfileDto } from './dto/update-profile.dto';

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

        // Progress only counts if their last active game was today
        const activeToday = user.lastStreakDate === today;
        const claimsToday = user.questClaimsDate === today ? user.questClaims : [];

        // Map the quests into an array so the frontend can easily render the UI cards
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

            // Update the user's claims array (resetting it if it's a new day)
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
}