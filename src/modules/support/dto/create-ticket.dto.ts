import { IsNotEmpty, IsString } from 'class-validator';

export class CreateTicketDto {
    @IsString() @IsNotEmpty()
    category: string;

    @IsString() @IsNotEmpty()
    subject: string;

    @IsString() @IsNotEmpty()
    description: string;
}