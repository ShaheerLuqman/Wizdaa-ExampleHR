import { IsArray } from 'class-validator';

export type BatchBalanceRecord = {
  employeeId?: string;
  locationId?: string;
  availableDays?: number;
};

export class BatchSyncDto {
  @IsArray()
  records!: BatchBalanceRecord[];
}
