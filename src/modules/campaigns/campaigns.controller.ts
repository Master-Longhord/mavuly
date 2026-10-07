import { Body, Controller, Get, Post } from '@nestjs/common';
import { CampaignsService } from './campaigns.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { AccountType, Role } from '@prisma/client';
import { CreateCampaignDto } from './dto/create-campaign.dto';
import { Public } from '../../common/decorators/public.decorator';

@Controller('campaigns')
export class CampaignsController {
    constructor(private readonly campaignsService: CampaignsService) { }

    @Roles(AccountType.DEVELOPER, Role.ADMIN)
    @Post()
    createCampaign(@CurrentUser('id') developerId: string, @Body() dto: CreateCampaignDto) {
        return this.campaignsService.createCampaign(developerId, dto);
    }

    @Roles(AccountType.DEVELOPER)
    @Get('dashboard')
    getDashboardStats(@CurrentUser('id') developerId: string) {
        return this.campaignsService.getDeveloperDashboardStats(developerId);
    }

    @Public()
    @Get('active')
    getActiveCampaigns() {
        return this.campaignsService.getActiveCampaigns();
    }

    @Roles(AccountType.DEVELOPER)
    @Get('mine')
    getMyCampaigns(@CurrentUser('id') developerId: string) {
        return this.campaignsService.getDeveloperCampaigns(developerId);
    }
}