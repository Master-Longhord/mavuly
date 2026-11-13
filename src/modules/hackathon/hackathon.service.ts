import { Injectable, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../common/prisma/prisma.service';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class HackathonService {
    private s3Client: S3Client;

    constructor(
        private prisma: PrismaService,
        private configService: ConfigService,
    ) {
        this.s3Client = new S3Client({
            region: 'us-east-1',
            endpoint: this.configService.get<string>('MINIO_ENDPOINT'),
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

        return this.prisma.hackathonParticipant.create({
            data: { userId },
            include: { user: { select: { name: true, email: true, phone: true } } }
        });
    }

    async getAdminParticipants() {
        return this.prisma.hackathonParticipant.findMany({
            orderBy: { joinedAt: 'desc' },
            include: {
                user: {
                    select: {
                        id: true,
                        name: true,
                        email: true,
                        phone: true,
                    }
                }
            }
        });
    }

    async generatePresignedUrl(userId: string, contentType: string, extension: string) {
        const participant = await this.prisma.hackathonParticipant.findUnique({ where: { userId } });
        if (!participant) {
            throw new BadRequestException('You must join the hackathon first before uploading a demo.');
        }

        if (!contentType.startsWith('video/')) {
            throw new BadRequestException('Only video files are allowed');
        }

        const bucketName = this.configService.get<string>('MINIO_BUCKET_NAME');
        const endpoint = this.configService.get<string>('MINIO_ENDPOINT');
        const fileKey = `hackathon-demos/${userId}/${uuidv4()}.${extension}`;

        const command = new PutObjectCommand({
            Bucket: bucketName,
            Key: fileKey,
            ContentType: contentType,
        });

        const uploadUrl = await getSignedUrl(this.s3Client, command, { expiresIn: 900 });
        const finalVideoUrl = `${endpoint}/${bucketName}/${fileKey}`;

        return { uploadUrl, finalVideoUrl, fileKey };
    }

    async registerEntry(userId: string, data: { teamName: string; projectName: string; description: string; videoUrl: string; githubUrl?: string }) {
        const participant = await this.prisma.hackathonParticipant.findUnique({ where: { userId } });
        if (!participant) {
            throw new BadRequestException('You must join the hackathon first.');
        }

        const existingEntry = await this.prisma.hackathonEntry.findFirst({
            where: { userId },
        });

        if (existingEntry) {
            throw new BadRequestException('You have already submitted a hackathon project.');
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

    async getMyEntry(userId: string) {
        return this.prisma.hackathonEntry.findFirst({
            where: { userId },
        });
    }
}