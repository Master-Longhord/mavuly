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

        const participant = await this.prisma.hackathonParticipant.create({
            data: { userId },
            include: { user: true },
        });

        const whatsappLink = `https://api.mavuly.com/api/v1/hackathon/whatsapp`;

        try {
            await this.mailService.sendHackathonWelcomeEmail(
                participant.user.email,
                participant.user.name || 'Developer',
                whatsappLink,
            );
        } catch (error) {
            console.error('Failed to send hackathon welcome email:', error);
        }

        return {
            success: true,
            message: 'Successfully joined the hackathon',
            whatsappLink,
        };
    }

    async getMyEntryStatus(userId: string) {
        const participant = await this.prisma.hackathonParticipant.findUnique({ where: { userId } });
        const entry = await this.prisma.hackathonEntry.findFirst({ where: { userId } });
        return { joined: !!participant, entry };
    }

    async getAdminParticipants(page: number, limit: number) {
        const skip = (page - 1) * limit;
        const [items, total] = await Promise.all([
            this.prisma.hackathonParticipant.findMany({
                skip,
                take: limit,
                orderBy: { joinedAt: 'desc' },
                include: { user: { select: { name: true, email: true, phone: true } } },
            }),
            this.prisma.hackathonParticipant.count(),
        ]);

        const data = items.map(item => ({
            name: item.user.name,
            email: item.user.email,
            phone: item.user.phone,
            joinedAt: item.joinedAt,
        }));

        return {
            data,
            meta: { total, page, totalPages: Math.ceil(total / limit) },
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
                ['eq', '$Content-Type', contentType],
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

        const deadline = new Date('2026-11-20T23:59:59Z');
        if (new Date() > deadline) {
            throw new BadRequestException('The hackathon submission deadline has passed (Nov 20, 2026).');
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
                participant.user.name || 'Developer',
                data.projectName,
            );
        } catch (error) {
            console.error('Failed to send hackathon submission email:', error);
        }

        return entry;
    }
}