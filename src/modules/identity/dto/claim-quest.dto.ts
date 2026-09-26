import { IsNotEmpty, IsString } from 'class-validator';

export class ClaimQuestDto {
    @IsString()
    @IsNotEmpty()
    questId: string;
}