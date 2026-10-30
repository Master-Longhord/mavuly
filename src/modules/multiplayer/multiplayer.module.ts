import { Module } from '@nestjs/common';
import { MultiplayerService } from './multiplayer.service';
import { MultiplayerGateway } from './multiplayer.gateway';
import { JwtModule } from '@nestjs/jwt';
import { WhotService } from './games/whot.service';

@Module({
  imports: [JwtModule],
  providers: [MultiplayerGateway, MultiplayerService, WhotService],
})
export class MultiplayerModule { }