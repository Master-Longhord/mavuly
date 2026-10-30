import { Module } from '@nestjs/common';
import { MultiplayerService } from './multiplayer.service';
import { MultiplayerGateway } from './multiplayer.gateway';
import { JwtModule } from '@nestjs/jwt';
import { WhotService } from './games/whot.service';
import { UnoService } from './games/uno.service';
import { LudoService } from './games/ludo.service';

@Module({
  imports: [JwtModule],
  providers: [MultiplayerGateway, MultiplayerService, WhotService, UnoService, LudoService],
})
export class MultiplayerModule { }