import { Body, Controller, Post } from '@nestjs/common';
import { ArcadeService } from './arcade.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JoinMatchDto } from './dto/join-match.dto';
import { SubmitScoreDto } from './dto/submit-score.dto';

@Controller('arcade')
export class ArcadeController {
    constructor(private readonly arcadeService: ArcadeService) { }

    @Post('join')
    joinMatch(@CurrentUser('id') userId: string, @Body() dto: JoinMatchDto) {
        return this.arcadeService.joinMatch(userId, dto);
    }

    @Post('submit-score')
    submitScore(@CurrentUser('id') userId: string, @Body() dto: SubmitScoreDto) {
        return this.arcadeService.submitScore(userId, dto);
    }
}