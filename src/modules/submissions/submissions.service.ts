import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { StartSubmissionDto } from './dto/start-submission.dto';
import { SubmitTaskDto } from './dto/submit-task.dto';
import { ReviewAction, ReviewSubmissionDto } from './dto/review-submission.dto';
import { SubmissionStatus, TransactionType, AccountType } from '@prisma/client';
import { VerifyPostbackDto } from './dto/verify-postback.dto';

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
                campaign: { developerId }
            },
            include: {
                campaign: { select: { title: true, appName: true, rewardPerTask: true } },
                feedback: true,
                tester: { select: { name: true, email: true } }
            },
            orderBy: { startedAt: 'desc' },
        });
    }

    async verifyPostback(apiKey: string, dto: VerifyPostbackDto) {
        const developer = await this.prisma.user.findUnique({
            where: { apiKey }
        });

        if (!developer || developer.accountType !== 'DEVELOPER') {
            throw new UnauthorizedException('Invalid API Key');
        }

        const submission = await this.prisma.taskSubmission.findUnique({
            where: { id: dto.mav_uid },
            include: { campaign: true }
        });

        if (!submission) {
            throw new NotFoundException('Submission not found for this mav_uid');
        }

        if (submission.campaign.developerId !== developer.id) {
            throw new ForbiddenException('This submission belongs to a different developer');
        }

        if (submission.status === SubmissionStatus.APPROVED) {
            return { message: 'Submission was already approved and paid out.' };
        }

        const rewardAmount = submission.campaign.rewardPerTask;

        await this.prisma.$transaction(async (tx) => {
            await tx.taskSubmission.update({
                where: { id: submission.id },
                data: {
                    status: SubmissionStatus.APPROVED,
                    verifiedAt: new Date(),
                    verificationStatus: `Auto-approved via S2S Postback (Event: ${dto.event})`
                }
            });

            await tx.user.update({
                where: { id: submission.testerId },
                data: { escrowBalance: { increment: rewardAmount } }
            });

            await tx.transaction.create({
                data: {
                    userId: submission.testerId,
                    submissionId: submission.id,
                    amount: rewardAmount,
                    type: TransactionType.REWARD,
                    status: 'COMPLETED',
                    reference: `S2S-REWARD-${submission.id}`,
                    description: `Auto-Reward for testing ${submission.campaign.appName}`,
                }
            });

            await tx.campaign.update({
                where: { id: submission.campaign.id },
                data: {
                    budgetRemaining: { decrement: rewardAmount },
                    completedTesters: { increment: 1 },
                }
            });
        });

        return {
            status: 'success',
            message: 'Tester successfully auto-approved and rewarded!'
        };
    }

    async updateBugStatus(developerId: string, feedbackId: string, bugStatus: string, bugSeverity?: string) {
        // 1. Find the feedback and check if the dev owns the campaign it belongs to
        const feedback = await this.prisma.feedback.findUnique({
            where: { id: feedbackId },
            include: { submission: { include: { campaign: true } } }
        });

        if (!feedback) throw new NotFoundException('Feedback/Bug report not found');

        if (feedback.submission.campaign.developerId !== developerId) {
            throw new ForbiddenException('You do not own the campaign for this bug report');
        }

        // 2. Update the status and severity
        return this.prisma.feedback.update({
            where: { id: feedbackId },
            data: {
                bugStatus,
                ...(bugSeverity && { bugSeverity })
            }
        });
    }
}