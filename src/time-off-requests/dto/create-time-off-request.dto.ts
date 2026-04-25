import { IsNumber, IsPositive, IsString, MinLength } from 'class-validator';

export class CreateTimeOffRequestDto {
  @IsString()
  @MinLength(1)
  employeeId!: string;

  @IsString()
  @MinLength(1)
  locationId!: string;

  @IsNumber()
  @IsPositive()
  daysRequested!: number;

  @IsString()
  @MinLength(8)
  idempotencyKey!: string;
}
