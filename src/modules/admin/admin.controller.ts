import { Controller, Get } from '@nestjs/common';
import { AdminService } from './admin.service';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '@prisma/client';

@Controller('admin')
@Roles(Role.ADMIN)
export class AdminController {
    constructor(private readonly adminService: AdminService) { }

    @Get('dashboard-stats')
    getDashboardStats() {
        return this.adminService.getDashboardStats();
    }

    @Get('users')
    getAllUsers() {
        return this.adminService.getAllUsers();
    }

    @Get('referrals')
    getReferralLeaderboard() {
        return this.adminService.getReferralLeaderboard();
    }

    @Get('campaigns')
    getAllCampaigns() {
        return this.adminService.getAllCampaigns();
    }

    @Get('payouts')
    getAllPayouts() {
        return this.adminService.getAllPayouts();
    }

    @Get('disputes')
    getAllDisputes() {
        return this.adminService.getAllDisputes();
    }
}