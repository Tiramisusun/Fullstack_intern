import { IsInt, IsString, Min } from "class-validator";

export class CreateReservationDto {
  @IsString()
  productId!: string;

  @IsString()
  userId!: string;

  @IsInt()
  @Min(1)
  quantity = 1;
}
