import { Controller, Post, Get, Body, Req, Query, Headers, UnauthorizedException, UseGuards, Redirect } from '@nestjs/common';
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
    private readonly configService: ConfigService,
  ) { }

  @Post('join')
  async joinHackathon(@Req() req: any) {
    return this.hackathonService.joinHackathon(req.user.id);
  }

  @Post('upload-url')
  async getUploadUrl(@Req() req: any, @Body() body: { contentType: string; extension?: string }) {
    return this.hackathonService.generateUploadPolicy(req.user.id, body.contentType);
  }

  @Post('register')
  async register(
    @Req() req: any,
    @Body()
    body: {
      teamName: string;
      projectName: string;
      description: string;
      videoUrl?: string;
      pitchDeckUrl?: string;
      githubUrl?: string;
    },
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
    @Headers('x-team-key') teamKey?: string,
    @Query('team_key') queryTeamKey?: string,
    @Query('page') page: string = '1',
    @Query('limit') limit: string = '20',
  ) {
    const expectedKey = this.configService.get<string>('HACKATHON_TEAM_KEY') || 'mavuly_rocks_2026';
    const providedKey = teamKey || queryTeamKey;

    if (!providedKey || providedKey !== expectedKey) {
      throw new UnauthorizedException('Invalid team key.');
    }

    return this.hackathonService.getAdminParticipants(Number(page), Number(limit));
  }

  @Public()
  @Throttle({ default: { limit: 3, ttl: 60000 } })
  @Post('participants/broadcast-whatsapp')
  async broadcastWhatsapp(
    @Headers('x-team-key') teamKey?: string,
    @Query('team_key') queryTeamKey?: string,
  ) {
    const expectedKey = this.configService.get<string>('HACKATHON_TEAM_KEY') || 'mavuly_rocks_2026';
    const providedKey = teamKey || queryTeamKey;

    if (!providedKey || providedKey !== expectedKey) {
      throw new UnauthorizedException('Invalid team key.');
    }

    return this.hackathonService.broadcastOnboardingEmailToAllParticipants();
  }

  @Public()
  @Throttle({ default: { limit: 3, ttl: 60000 } })
  @Post('participants/broadcast-onboarding')
  async broadcastOnboarding(
    @Headers('x-team-key') teamKey?: string,
    @Query('team_key') queryTeamKey?: string,
  ) {
    const expectedKey = this.configService.get<string>('HACKATHON_TEAM_KEY') || 'mavuly_rocks_2026';
    const providedKey = teamKey || queryTeamKey;

    if (!providedKey || providedKey !== expectedKey) {
      throw new UnauthorizedException('Invalid team key.');
    }

    return this.hackathonService.broadcastOnboardingEmailToAllParticipants();
  }

  @Public()
  @Get('whatsapp')
  @Redirect()
  getWhatsappLink() {
    const url = this.configService.get<string>('WHATSAPP_GROUP_LINK') || 'https://chat.whatsapp.com/ClwFijiQ7Y8BBs7X04K81k';
    return { url, statusCode: 302 };
  }
}