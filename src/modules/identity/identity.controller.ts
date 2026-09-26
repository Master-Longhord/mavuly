import { Body, Controller, Get, Patch, Post } from '@nestjs/common';
import { IdentityService } from './identity.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { UpdateProfileDto } from './dto/update-profile.dto';

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
}