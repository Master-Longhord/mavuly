// src/modules/arcade/dto/join-match.dto.ts
import { IsEnum, IsInt, IsNotEmpty, Min } from 'class-validator';
import { GameType } from '@prisma/client';

export class JoinMatchDto {
    @IsEnum(GameType, { message: 'Invalid game type' })
    @IsNotEmpty()
    gameType: GameType;

    @IsInt()
    @Min(10, { message: 'Minimum stake amount is 10 coins' })
    stakeAmount: number;
}