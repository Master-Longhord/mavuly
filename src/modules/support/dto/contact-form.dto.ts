import { IsEmail, IsNotEmpty, IsString } from 'class-validator';

export class ContactFormDto {
    @IsEmail() @IsNotEmpty()
    email: string;

    @IsString() @IsNotEmpty()
    subject: string;

    @IsString() @IsNotEmpty()
    message: string;
}