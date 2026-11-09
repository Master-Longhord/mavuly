import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
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

    @Roles(AccountType.DEVELOPER)
    @Get('analytics')
    getAnalytics(@CurrentUser('id') developerId: string) {
        return this.campaignsService.getDeveloperAnalytics(developerId);
    }

    @Roles(AccountType.DEVELOPER)
    @Get('results')
    getResults(
        @CurrentUser('id') developerId: string,
        @Query('days') days?: string,
        @Query('campaignId') campaignId?: string
    ) {
        return this.campaignsService.getDeveloperResults(developerId, days ? Number(days) : 30, campaignId);
    }

    @Roles(AccountType.DEVELOPER)
    @Get('mine')
    getMyCampaigns(@CurrentUser('id') developerId: string) {
        return this.campaignsService.getDeveloperCampaigns(developerId);
    }

    @Public()
    @Get('active')
    getActiveCampaigns() {
        return this.campaignsService.getActiveCampaigns();
    }

    @Public()
    @Get(':id')
    getCampaignById(@Param('id') campaignId: string) {
        return this.campaignsService.getCampaignById(campaignId);
    }
}