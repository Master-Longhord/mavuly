import { Injectable, BadRequestException, ConflictException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../common/prisma/prisma.service';
import { S3Client } from '@aws-sdk/client-s3';
import { createPresignedPost } from '@aws-sdk/s3-presigned-post';
import { v4 as uuidv4 } from 'uuid';
import { MailService } from '../mail/mail.service';

const ALLOWED_UPLOADS: Record<string, string> = {
    'video/mp4': 'mp4',
    'video/webm': 'webm',
    'video/quicktime': 'mov',
    'application/pdf': 'pdf',
    'application/msword': 'doc',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
};

@Injectable()
export class HackathonService {
    private s3Client: S3Client;

    constructor(
        private prisma: PrismaService,
        private configService: ConfigService,
        private mailService: MailService,
    ) {
        let endpoint = this.configService.get<string>('MINIO_ENDPOINT');
        if (endpoint && endpoint.endsWith('/')) {
            endpoint = endpoint.slice(0, -1);
        }

        this.s3Client = new S3Client({
            region: 'us-east-1',
            endpoint: endpoint,
            forcePathStyle: true,
            credentials: {
                accessKeyId: this.configService.get<string>('MINIO_ACCESS_KEY')!,
                secretAccessKey: this.configService.get<string>('MINIO_SECRET_KEY')!,
            },
        });
    }

    async joinHackathon(userId: string) {
        const existing = await this.prisma.hackathonParticipant.findUnique({
            where: { userId },
        });

        if (existing) {
            throw new BadRequestException('You have already joined the hackathon.');
        }

        const registrationDeadline = new Date('2026-11-27T23:59:59+01:00');
        if (new Date() > registrationDeadline) {
            throw new BadRequestException('Hackathon registration closed on November 27, 2026 (11:59 PM WAT).');
        }

        const participant = await this.prisma.hackathonParticipant.create({
            data: { userId },
            include: { user: true },
        });

        const whatsappLink = `https://api.mavuly.com/api/v1/hackathon/whatsapp`;

        try {
            await this.mailService.sendHackathonWelcomeEmail(
                participant.user.email,
                participant.user.name || 'Participant',
                whatsappLink,
            );
        } catch (error) {
            console.error('Failed to send hackathon welcome email:', error);
        }

        return {
            success: true,
            message: 'Successfully joined the hackathon',
            whatsappLink,
            referralCode: participant.user.referralCode,
            referralLink: participant.user.referralCode
                ? `https://mavuly.com/register?ref=${participant.user.referralCode}`
                : null,
        };
    }

    async broadcastWhatsappEmailToAllParticipants() {
        const participants = await this.prisma.hackathonParticipant.findMany({
            include: {
                user: {
                    select: { email: true, name: true },
                },
            },
        });

        const whatsappLink = `https://api.mavuly.com/api/v1/hackathon/whatsapp`;
        let emailsSent = 0;
        let failed = 0;

        for (const item of participants) {
            if (!item.user?.email) continue;
            try {
                await this.mailService.sendHackathonScheduleUpdateEmail(
                    item.user.email,
                    item.user.name || 'Participant',
                    whatsappLink,
                );
                emailsSent++;
            } catch (error) {
                console.error(`Failed to send broadcast email to ${item.user.email}:`, error);
                failed++;
            }
        }

        return {
            success: true,
            message: 'Revised Hackathon dates broadcast completed.',
            totalParticipants: participants.length,
            emailsSent,
            failed,
        };
    }

    async getMyEntryStatus(userId: string) {
        const [participant, entry, user] = await Promise.all([
            this.prisma.hackathonParticipant.findUnique({ where: { userId } }),
            this.prisma.hackathonEntry.findFirst({ where: { userId } }),
            this.prisma.user.findUnique({
                where: { id: userId },
                select: {
                    referralCode: true,
                    referrals: { select: { isEmailVerified: true } },
                },
            }),
        ]);

        const totalReferrals = user?.referrals.length || 0;
        const verifiedReferrals = user?.referrals.filter(r => r.isEmailVerified).length || 0;

        return {
            joined: !!participant,
            entry,
            referralCode: user?.referralCode || null,
            referralLink: user?.referralCode ? `https://mavuly.com/register?ref=${user.referralCode}` : null,
            totalReferrals,
            verifiedReferrals,
        };
    }

    async getAdminParticipants(page: number = 1, limit: number = 20) {
        const safePage = Math.max(1, Number(page) || 1);
        const safeLimit = Math.max(1, Math.min(100, Number(limit) || 20));
        const skip = (safePage - 1) * safeLimit;

        const [items, total] = await Promise.all([
            this.prisma.hackathonParticipant.findMany({
                skip,
                take: safeLimit,
                orderBy: { joinedAt: 'desc' },
                include: {
                    user: {
                        select: {
                            name: true,
                            email: true,
                            phone: true,
                            referralCode: true,
                            referrals: { select: { isEmailVerified: true } },
                        },
                    },
                },
            }),
            this.prisma.hackathonParticipant.count(),
        ]);

        const data = items.map(item => {
            const referrals = item.user?.referrals || [];
            const code = item.user?.referralCode ?? null;
            return {
                name: item.user?.name ?? null,
                email: item.user?.email ?? null,
                phone: item.user?.phone ?? null,
                joinedAt: item.joinedAt,
                referralCode: code,
                referralLink: code ? `https://mavuly.com/register?ref=${code}` : null,
                totalReferrals: referrals.length,
                verifiedReferrals: referrals.filter(r => r.isEmailVerified).length,
            };
        });

        return {
            data,
            meta: {
                total,
                page: safePage,
                totalPages: Math.max(1, Math.ceil(total / safeLimit)),
            },
        };
    }

    async generateUploadPolicy(userId: string, contentType: string) {
        const participant = await this.prisma.hackathonParticipant.findUnique({ where: { userId } });
        if (!participant) {
            throw new BadRequestException('You must join the hackathon first.');
        }

        const safeExt = ALLOWED_UPLOADS[contentType];
        if (!safeExt) {
            throw new BadRequestException('Only PDF, DOC, DOCX, MP4, WebM, and MOV formats are allowed.');
        }

        const bucketName = this.configService.get<string>('MINIO_BUCKET_NAME')!;
        let endpoint = this.configService.get<string>('MINIO_ENDPOINT')!;
        if (endpoint.endsWith('/')) endpoint = endpoint.slice(0, -1);

        const fileKey = `hackathon-demos/${userId}/${uuidv4()}.${safeExt}`;

        const { url, fields } = await createPresignedPost(this.s3Client, {
            Bucket: bucketName,
            Key: fileKey,
            Conditions: [
                ['content-length-range', 1, 314572800],
            ],
            Fields: {
                'Content-Type': contentType,
            },
            Expires: 1800,
        });

        const finalVideoUrl = `${endpoint}/${bucketName}/${fileKey}`;
        return { uploadUrl: url, fields, finalVideoUrl, finalFileUrl: finalVideoUrl };
    }

    async registerEntry(
        userId: string,
        data: {
            teamName: string;
            projectName: string;
            description: string;
            videoUrl?: string;
            pitchDeckUrl?: string;
            githubUrl?: string;
        },
    ) {
        const participant = await this.prisma.hackathonParticipant.findUnique({
            where: { userId },
            include: { user: true },
        });
        if (!participant) throw new BadRequestException('You must join the hackathon first.');

        const existingEntry = await this.prisma.hackathonEntry.findFirst({ where: { userId } });
        if (existingEntry) throw new ConflictException('You have already submitted a hackathon project.');

        const submissionDeadline = new Date('2026-12-06T23:59:59+01:00');
        if (new Date() > submissionDeadline) {
            throw new BadRequestException('The hackathon submission deadline has passed (Dec 6, 2026 at 11:59 PM WAT).');
        }

        if (!data.teamName || data.teamName.length < 2 || data.teamName.length > 60) {
            throw new BadRequestException('Team name must be 2-60 characters.');
        }
        if (!data.projectName || data.projectName.length < 2 || data.projectName.length > 80) {
            throw new BadRequestException('Project name must be 2-80 characters.');
        }
        if (!data.description || data.description.length < 20 || data.description.length > 2000) {
            throw new BadRequestException('Description must be 20-2000 characters.');
        }

        if (data.githubUrl && !data.githubUrl.startsWith('https://github.com/')) {
            throw new BadRequestException('GitHub URL must be a valid https://github.com/ link.');
        }

        if (!data.videoUrl && !data.pitchDeckUrl) {
            throw new BadRequestException('Please provide a pitch deck or demo video.');
        }

        if (data.videoUrl && !data.videoUrl.includes(`hackathon-demos/${userId}/`)) {
            throw new BadRequestException('Invalid video URL ownership. You can only submit files you uploaded.');
        }

        if (data.pitchDeckUrl && !data.pitchDeckUrl.includes(`hackathon-demos/${userId}/`)) {
            throw new BadRequestException('Invalid pitch deck URL ownership. You can only submit files you uploaded.');
        }

        const entry = await this.prisma.hackathonEntry.create({
            data: {
                userId,
                teamName: data.teamName,
                projectName: data.projectName,
                description: data.description,
                videoUrl: data.videoUrl || null,
                pitchDeckUrl: data.pitchDeckUrl || null,
                githubUrl: data.githubUrl,
            },
        });

        try {
            await this.mailService.sendHackathonSubmissionEmail(
                participant.user.email,
                participant.user.name || 'Participant',
                data.projectName,
            );
        } catch (error) {
            console.error('Failed to send hackathon submission email:', error);
        }

        return entry;
    }
}