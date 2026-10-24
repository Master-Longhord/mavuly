import { Body, Controller, Get, Patch, Post } from '@nestjs/common';
import { IdentityService } from './identity.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { ClaimQuestDto } from './dto/claim-quest.dto';
import { Roles } from '../../common/decorators/roles.decorator';
import { UpdatePostbackDto } from './dto/update-postback.dto';

@Controller('identity')
export class IdentityController {
    constructor(private readonly identityService: IdentityService) { }

    @Get('me')
    getProfile(@CurrentUser('id') userId: string) {
        return this.identityService.getProfile(userId);
    }

    @Patch('me')
    updateProfile(
        @CurrentUser('id') userId: string,
        @Body() dto: UpdateProfileDto,
    ) {
        return this.identityService.updateProfile(userId, dto);
    }

    @Post('claim-daily')
    claimDailyReward(@CurrentUser('id') userId: string) {
        return this.identityService.claimDailyReward(userId);
    }

    @Get('quests')
    getDailyQuests(@CurrentUser('id') userId: string) {
        return this.identityService.getDailyQuests(userId);
    }

    @Post('quests/claim')
    claimQuest(
        @CurrentUser('id') userId: string,
        @Body() dto: ClaimQuestDto,
    ) {
        return this.identityService.claimQuest(userId, dto.questId);
    }

    @Get('referrals')
    getReferralStats(@CurrentUser('id') userId: string) {
        return this.identityService.getReferralStats(userId);
    }

    @Get('wallet/balances')
    getWalletBalances(@CurrentUser('id') userId: string) {
        return this.identityService.getWalletBalances(userId);
    }

    @Get('notifications')
    getNotifications(@CurrentUser('id') userId: string) {
        return this.identityService.getNotifications(userId);
    }

    @Patch('notifications/read')
    markNotificationsRead(@CurrentUser('id') userId: string) {
        return this.identityService.markNotificationsRead(userId);
    }

    @Roles('DEVELOPER')
    @Patch('kyb-documents')
    uploadKybDocuments(
        @CurrentUser('id') userId: string,
        @Body() dto: { businessDocUrl?: string; idDocUrl?: string; addressDocUrl?: string }
    ) {
        return this.identityService.uploadKybDocuments(userId, dto);
    }

    @Roles('DEVELOPER')
    @Post('apps')
    registerDeveloperApp(
        @CurrentUser('id') userId: string,
        @Body() dto: { name: string; type: string; version?: string; description?: string }
    ) {
        return this.identityService.registerDeveloperApp(userId, dto);
    }

    @Roles('DEVELOPER')
    @Get('apps')
    getDeveloperApps(@CurrentUser('id') userId: string) {
        return this.identityService.getDeveloperApps(userId);
    }

    @Roles('DEVELOPER')
    @Post('api-keys/generate')
    generateApiKeys(@CurrentUser('id') userId: string) {
        return this.identityService.generateApiKeys(userId);
    }

    @Roles('DEVELOPER')
    @Patch('api-keys/postback')
    updatePostbackUrl(@CurrentUser('id') userId: string, @Body() dto: UpdatePostbackDto) {
        return this.identityService.updatePostbackUrl(userId, dto.postbackUrl);
    }

    @Post('ad-refill')
    claimAdRefill(@CurrentUser('id') userId: string) {
        return this.identityService.claimAdRefill(userId);
    }
}