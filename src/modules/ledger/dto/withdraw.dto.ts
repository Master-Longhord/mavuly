import { IsInt, Min } from 'class-validator';

export class WithdrawDto {
    @IsInt()
    @Min(1000, { message: 'Minimum withdrawal is 1,000 KudiCoins ($1.00)' })
    amount: number;
}