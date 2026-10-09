import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CreateCampaignDto } from './dto/create-campaign.dto';
import { AccountType, EscrowTxType } from '@prisma/client';

@Injectable()
export class CampaignsService {
    constructor(private prisma: PrismaService) { }

    async createCampaign(developerId: string, dto: CreateCampaignDto) {
        const developer = await this.prisma.user.findUnique({ where: { id: developerId } });

        if (!developer || developer.accountType !== AccountType.DEVELOPER) {
            throw new BadRequestException('Only Developers can create testing campaigns.');
        }

        // Formula: (Reward Per Task * Target Testers) + 10% Platform Fee
        const baseBudget = dto.rewardPerTask * dto.targetTesters;
        const platformFeePercent = 0.10;
        const totalRequired = baseBudget * (1 + platformFeePercent);

        if (Number(developer.escrowBalance) < totalRequired) {
            throw new BadRequestException(`Insufficient escrow balance. You need $${totalRequired.toFixed(2)}.`);
        }

        // ATOMIC TRANSACTION: Deduct money, lock in Escrow, and create Campaign
        return this.prisma.$transaction(async (tx) => {
            await tx.user.update({
                where: { id: developerId },
                data: { escrowBalance: { decrement: totalRequired } },
            });

            const campaign = await tx.campaign.create({
                data: {
                    developerId,
                    title: dto.title,
                    appName: dto.appName,
                    targetUrl: dto.targetUrl,
                    category: dto.category,
                    instructions: dto.instructions,
                    requirements: dto.requirements || {},
                    estimatedMinutes: dto.estimatedMinutes,
                    difficulty: dto.difficulty,
                    targetTesters: dto.targetTesters,
                    rewardPerTask: dto.rewardPerTask,
                    totalBudget: baseBudget,
                    budgetRemaining: baseBudget,
                    platformFeePercent: platformFeePercent,
                },
            });

            await tx.escrowTransaction.create({
                data: {
                    developerId,
                    campaignId: campaign.id,
                    amount: totalRequired,
                    type: EscrowTxType.ALLOCATION,
                    reference: `ESC-ALLOC-${campaign.id}`,
                },
            });

            return campaign;
        });
    }

    async getActiveCampaigns() {
        return this.prisma.campaign.findMany({
            where: {
                status: 'ACTIVE',
                budgetRemaining: { gt: 0 },
            },
            orderBy: { createdAt: 'desc' },
            select: {
                id: true,
                title: true,
                appName: true,
                category: true,
                rewardPerTask: true,
                targetTesters: true,
                completedTesters: true,
                estimatedMinutes: true,
                difficulty: true,
                requirements: true,
            },
        });
    }

    async getDeveloperDashboardStats(developerId: string) {
        const campaigns = await this.prisma.campaign.findMany({
            where: { developerId },
            select: { status: true, completedTesters: true },
        });

        const activeTasksCount = campaigns.filter((c) => c.status === 'ACTIVE').length;
        const totalTestersCount = campaigns.reduce((sum, c) => sum + c.completedTesters, 0);

        return {
            activeTasks: activeTasksCount,
            totalTesters: totalTestersCount,
            completedTests: totalTestersCount,
            feedbackReceived: totalTestersCount,
        };
    }

    async getDeveloperCampaigns(developerId: string) {
        return this.prisma.campaign.findMany({
            where: { developerId },
            orderBy: { createdAt: 'desc' },
        });
    }
}