import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
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
                    // --- NEW FIELDS SAVED HERE ---
                    productType: dto.productType || 'App',
                    platforms: dto.platforms || ['Android'],
                    description: dto.description,
                    version: dto.version,
                    deadline: dto.deadline ? new Date(dto.deadline) : null,
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

    async getCampaignById(campaignId: string) {
        const campaign = await this.prisma.campaign.findUnique({
            where: { id: campaignId },
            include: {
                developer: { select: { studioName: true, name: true } }, // Show who made the app
            }
        });

        if (!campaign) {
            throw new NotFoundException('Campaign not found');
        }

        // Hide targetUrl from testers unless they officially "Start" the task
        const { targetUrl, ...safeCampaign } = campaign;
        return safeCampaign;
    }

    async getDeveloperAnalytics(developerId: string) {
        const campaigns = await this.prisma.campaign.findMany({
            where: { developerId },
            include: {
                submissions: {
                    select: { status: true, startedAt: true, verifiedAt: true }
                }
            },
            orderBy: { createdAt: 'desc' }
        });

        let tasksStarted = 0;
        let totalConversions = 0;
        let totalSpend = 0;

        const campaignRows = campaigns.map(c => {
            const started = c.submissions.length;
            const approved = c.submissions.filter(s => s.status === 'APPROVED').length;
            const rate = started > 0 ? Math.round((approved / started) * 100) : 0;
            const spend = approved * Number(c.rewardPerTask) * (1 + Number(c.platformFeePercent));

            tasksStarted += started;
            totalConversions += approved;
            totalSpend += spend;

            return {
                id: c.id,
                title: c.title,
                convCount: approved,
                rate,
                spend: Number(spend.toFixed(2))
            };
        });

        const conversionRate = tasksStarted > 0 ? Math.round((totalConversions / tasksStarted) * 100) : 0;

        const graph = [];
        for (let i = 13; i >= 0; i--) {
            const d = new Date();
            d.setUTCHours(0, 0, 0, 0);
            d.setUTCDate(d.getUTCDate() - i);
            const dayStr = d.toISOString().slice(0, 10);

            let engagements = 0;
            let conversions = 0;

            for (const c of campaigns) {
                for (const s of c.submissions) {
                    if (s.startedAt.toISOString().slice(0, 10) === dayStr) engagements++;
                    if (s.status === 'APPROVED' && s.verifiedAt && s.verifiedAt.toISOString().slice(0, 10) === dayStr) {
                        conversions++;
                    }
                }
            }

            graph.push({ day: dayStr, conversions, engagements });
        }

        return {
            totals: {
                totalConversions,
                tasksStarted,
                conversionRate,
                totalSpend: Number(totalSpend.toFixed(2))
            },
            graph,
            campaigns: campaignRows
        };
    }
}