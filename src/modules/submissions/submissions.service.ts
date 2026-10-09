import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { StartSubmissionDto } from './dto/start-submission.dto';
import { SubmitTaskDto } from './dto/submit-task.dto';
import { ReviewAction, ReviewSubmissionDto } from './dto/review-submission.dto';
import { SubmissionStatus, TransactionType, AccountType } from '@prisma/client';

@Injectable()
export class SubmissionsService {
    constructor(private prisma: PrismaService) { }

    // 1. Tester starts a task
    async startTask(testerId: string, dto: StartSubmissionDto) {
        const campaign = await this.prisma.campaign.findUnique({ where: { id: dto.campaignId } });

        if (!campaign || campaign.status !== 'ACTIVE') {
            throw new BadRequestException('Campaign is not active or does not exist.');
        }
        if (Number(campaign.budgetRemaining) < Number(campaign.rewardPerTask)) {
            throw new BadRequestException('This campaign has reached its budget limit.');
        }

        const existing = await this.prisma.taskSubmission.findUnique({
            where: { campaignId_testerId: { campaignId: dto.campaignId, testerId } }
        });

        if (existing) {
            throw new ConflictException('You have already started or completed this task.');
        }

        const submission = await this.prisma.taskSubmission.create({
            data: {
                campaignId: dto.campaignId,
                testerId,
                status: SubmissionStatus.STARTED,
            }
        });

        // Generate tracking URL (Appends user ID so the developer knows who clicked)
        const trackingUrl = `${campaign.targetUrl}?mav_uid=${submission.id}`;

        return {
            submissionId: submission.id,
            trackingUrl,
            instructions: campaign.instructions
        };
    }

    // 2. Tester submits screenshot
    async submitTask(testerId: string, submissionId: string, dto: SubmitTaskDto) {
        const submission = await this.prisma.taskSubmission.findUnique({ where: { id: submissionId } });
        if (!submission || submission.testerId !== testerId) {
            throw new ForbiddenException('Invalid submission');
        }
        if (submission.status !== SubmissionStatus.STARTED) {
            throw new BadRequestException('Task is not in a started state');
        }

        return this.prisma.$transaction(async (tx) => {
            const updated = await tx.taskSubmission.update({
                where: { id: submissionId },
                data: {
                    status: SubmissionStatus.SUBMITTED,
                    submittedAt: new Date(),
                }
            });

            await tx.feedback.create({
                data: {
                    submissionId,
                    screenshotUrl: dto.screenshotUrl,
                    deviceInfo: dto.deviceInfo || {},
                    comments: dto.comments,
                    rating: 5, // Default for MVP
                }
            });

            return updated;
        });
    }

    // 3. Developer Reviews the Task (Releases Escrow to Tester)
    async reviewSubmission(developerId: string, submissionId: string, dto: ReviewSubmissionDto) {
        const submission = await this.prisma.taskSubmission.findUnique({
            where: { id: submissionId },
            include: { campaign: true }
        });

        if (!submission) throw new NotFoundException('Submission not found');
        if (submission.campaign.developerId !== developerId) {
            throw new ForbiddenException('You do not own this campaign');
        }
        if (submission.status !== SubmissionStatus.SUBMITTED) {
            throw new BadRequestException('Submission is not pending review');
        }

        return this.prisma.$transaction(async (tx) => {
            if (dto.action === ReviewAction.REJECT) {
                return tx.taskSubmission.update({
                    where: { id: submissionId },
                    data: {
                        status: SubmissionStatus.REJECTED,
                        rejectionReason: dto.rejectionReason || 'Did not meet requirements',
                    }
                });
            }

            // ACCEPT LOGIC: Release funds to tester
            const rewardAmount = submission.campaign.rewardPerTask;

            // Mark submission approved
            const approvedSubmission = await tx.taskSubmission.update({
                where: { id: submissionId },
                data: {
                    status: SubmissionStatus.APPROVED,
                    verifiedAt: new Date(),
                }
            });

            // Credit the Tester's Escrow Balance (so they can withdraw real money later)
            await tx.user.update({
                where: { id: submission.testerId },
                data: { escrowBalance: { increment: rewardAmount } }
            });

            // Log the transaction
            await tx.transaction.create({
                data: {
                    userId: submission.testerId,
                    submissionId: submission.id,
                    amount: rewardAmount,
                    type: TransactionType.REWARD,
                    status: 'COMPLETED',
                    reference: `QA-REWARD-${submission.id}`,
                    description: `Reward for testing ${submission.campaign.appName}`,
                }
            });

            // Deduct from campaign budget
            await tx.campaign.update({
                where: { id: submission.campaign.id },
                data: {
                    budgetRemaining: { decrement: rewardAmount },
                    completedTesters: { increment: 1 },
                }
            });

            return approvedSubmission;
        });
    }

    async getDeveloperSubmissions(developerId: string) {
        return this.prisma.taskSubmission.findMany({
            where: {
                campaign: { developerId } // Find submissions tied to campaigns owned by this dev
            },
            include: {
                campaign: { select: { title: true, appName: true, rewardPerTask: true } },
                feedback: true, // Includes the screenshot URL, device info, and bug reports!
                tester: { select: { name: true, email: true } } // So the dev knows who tested it
            },
            orderBy: { startedAt: 'desc' },
        });
    }
}