import { Controller, Get, Query } from '@nestjs/common';
import { LeaderboardService } from './leaderboard.service';
import { Public } from '../../common/decorators/public.decorator';

@Controller('leaderboards')
export class LeaderboardController {
    constructor(private readonly leaderboardService: LeaderboardService) { }

    @Public()
    @Get('coins')
    getTopByCoins() {
        return this.leaderboardService.getTopByCoins();
    }

    @Public()
    @Get('streaks')
    getTopByStreak() {
        return this.leaderboardService.getTopByStreak();
    }
}