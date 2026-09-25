// src/modules/arcade/dto/submit-score.dto.ts
import { IsInt, IsNotEmpty, IsOptional, IsString, Min } from 'class-validator';

export class SubmitScoreDto {
    @IsString()
    @IsNotEmpty()
    matchId: string;

    @IsInt()
    @Min(0)
    score: number;

    // This will hold the words found, math answers, etc., for server validation
    @IsOptional()
    payload?: any;
}