import { Injectable, NotFoundException } from '@nestjs/common';
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
}