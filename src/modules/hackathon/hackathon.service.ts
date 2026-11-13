import { Injectable, BadRequestException, ConflictException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../common/prisma/prisma.service';
import { S3Client } from '@aws-sdk/client-s3';
import { createPresignedPost } from '@aws-sdk/s3-presigned-post';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class HackathonService {
    private s3Client: S3Client;

    constructor(
        private prisma: PrismaService,
        private configService: ConfigService,
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

        await this.prisma.hackathonParticipant.create({ data: { userId } });
        return { success: true, message: 'Successfully joined the hackathon' };
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
                include: { user: { select: { name: true, email: true, phone: true } } }
            }),
            this.prisma.hackathonParticipant.count()
        ]);

        const data = items.map(item => ({
            name: item.user.name,
            email: item.user.email,
            phone: item.user.phone,
            joinedAt: item.joinedAt
        }));

        return {
            data,
            meta: { total, page, totalPages: Math.ceil(total / limit) }
        };
    }

    async generateUploadPolicy(userId: string, contentType: string, extension: string) {
        const participant = await this.prisma.hackathonParticipant.findUnique({ where: { userId } });
        if (!participant) {
            throw new BadRequestException('You must join the hackathon first.');
        }

        const allowedTypes = ['video/mp4', 'video/webm', 'video/quicktime'];
        if (!allowedTypes.includes(contentType)) {
            throw new BadRequestException('Only MP4, WebM, and MOV formats are allowed.');
        }

        const bucketName = this.configService.get<string>('MINIO_BUCKET_NAME')!;
        let endpoint = this.configService.get<string>('MINIO_ENDPOINT')!;
        if (endpoint.endsWith('/')) endpoint = endpoint.slice(0, -1);

        const fileKey = `hackathon-demos/${userId}/${uuidv4()}.${extension}`;

        const { url, fields } = await createPresignedPost(this.s3Client, {
            Bucket: bucketName,
            Key: fileKey,
            Conditions: [
                ['content-length-range', 0, 314572800],
                ['eq', '$Content-Type', contentType]
            ],
            Expires: 1800,
        });

        const finalVideoUrl = `${endpoint}/${bucketName}/${fileKey}`;
        return { uploadUrl: url, fields, finalVideoUrl };
    }

    async registerEntry(userId: string, data: { teamName: string; projectName: string; description: string; videoUrl: string; githubUrl?: string }) {
        const participant = await this.prisma.hackathonParticipant.findUnique({ where: { userId } });
        if (!participant) throw new BadRequestException('You must join the hackathon first.');

        const existingEntry = await this.prisma.hackathonEntry.findFirst({ where: { userId } });
        if (existingEntry) throw new ConflictException('You have already submitted a hackathon project.');

        const deadline = new Date('2026-12-31T23:59:59Z');
        if (new Date() > deadline) throw new BadRequestException('The hackathon submission deadline has passed.');

        if (data.teamName.length < 2 || data.teamName.length > 60) throw new BadRequestException('Team name must be 2-60 characters.');
        if (data.projectName.length < 2 || data.projectName.length > 80) throw new BadRequestException('Project name must be 2-80 characters.');
        if (data.description.length < 20 || data.description.length > 2000) throw new BadRequestException('Description must be 20-2000 characters.');

        if (data.githubUrl && !data.githubUrl.startsWith('https://github.com/')) {
            throw new BadRequestException('GitHub URL must be a valid https://github.com/ link.');
        }

        if (!data.videoUrl.includes(`hackathon-demos/${userId}/`)) {
            throw new BadRequestException('Invalid video URL ownership. You can only submit videos you uploaded.');
        }

        return this.prisma.hackathonEntry.create({
            data: {
                userId,
                teamName: data.teamName,
                projectName: data.projectName,
                description: data.description,
                videoUrl: data.videoUrl,
                githubUrl: data.githubUrl,
            },
        });
    }
}