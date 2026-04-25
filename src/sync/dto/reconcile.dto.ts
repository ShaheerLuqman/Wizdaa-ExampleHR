import { IsString, MinLength } from 'class-validator';

export class ReconcileDto {
  @IsString()
  @MinLength(1)
  employeeId!: string;

  @IsString()
  @MinLength(1)
  locationId!: string;
}
