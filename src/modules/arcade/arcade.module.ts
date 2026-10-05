import { Module } from '@nestjs/common';
import { ArcadeController } from './arcade.controller';
import { ArcadeService } from './arcade.service';

@Module({
  controllers: [ArcadeController],
  providers: [ArcadeService]
})
export class ArcadeModule {}
