import { IsNotEmpty, IsString } from 'class-validator';

export class VerifyPostbackDto {
    @IsString() @IsNotEmpty()
    mav_uid: string;

    @IsString() @IsNotEmpty()
    event: string;
}