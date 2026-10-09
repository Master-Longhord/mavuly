import { Controller, Get } from '@nestjs/common';
import { AdminService } from './admin.service';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '@prisma/client';

@Controller('admin')
export class AdminController {
    constructor(private readonly adminService: AdminService) { }

    @Roles(Role.ADMIN)
    @Get('dashboard-stats')
    getDashboardStats() {
        return this.adminService.getDashboardStats();
    }
}