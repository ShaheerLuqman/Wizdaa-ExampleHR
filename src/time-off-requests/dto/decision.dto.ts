import { IsOptional, IsString, MinLength } from 'class-validator';

export class DecisionDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  reason?: string;
}
