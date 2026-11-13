import { Controller, Post, Get, Body, Req, Query, Headers, UnauthorizedException, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HackathonService } from './hackathon.service';
import { Public } from '../../common/decorators/public.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { Throttle } from '@nestjs/throttler';

@UseGuards(JwtAuthGuard)
@Controller('hackathon')
export class HackathonController {
    constructor(
        private readonly hackathonService: HackathonService,
        private readonly configService: ConfigService
    ) { }

    @Post('join')
    async joinHackathon(@Req() req: any) {
        return this.hackathonService.joinHackathon(req.user.id);
    }

    @Post('upload-url')
    async getUploadUrl(@Req() req: any, @Body() body: { contentType: string; extension: string }) {
        return this.hackathonService.generateUploadPolicy(req.user.id, body.contentType, body.extension);
    }

    @Post('register')
    async register(
        @Req() req: any,
        @Body() body: { teamName: string; projectName: string; description: string; videoUrl: string; githubUrl?: string }
    ) {
        return this.hackathonService.registerEntry(req.user.id, body);
    }

    @Get('my-entry')
    async getMyEntry(@Req() req: any) {
        return this.hackathonService.getMyEntryStatus(req.user.id);
    }

    @Public()
    @Throttle({ default: { limit: 10, ttl: 60000 } })
    @Get('participants')
    async getParticipants(
        @Headers('x-team-key') teamKey: string,
        @Query('page') page: string = '1',
        @Query('limit') limit: string = '20'
    ) {
        const expectedKey = this.configService.get<string>('HACKATHON_TEAM_KEY') || 'mavuly_rocks_2026';

        if (!teamKey || teamKey !== expectedKey) {
            throw new UnauthorizedException('Invalid team key. Access denied.');
        }

        return this.hackathonService.getAdminParticipants(Number(page), Number(limit));
    }
}