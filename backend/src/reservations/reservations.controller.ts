import { Body, Controller, Get, Param, Post, Query } from "@nestjs/common";
import { CreateReservationDto } from "./dto/create-reservation.dto";
import { ReservationsService } from "./reservations.service";

@Controller("reservations")
export class ReservationsController {
  constructor(private readonly reservationsService: ReservationsService) {}

  @Post()
  create(@Body() dto: CreateReservationDto) {
    return this.reservationsService.create(dto);
  }

  @Get()
  findForUser(@Query("userId") userId?: string) {
    return this.reservationsService.findForUser(userId);
  }

  @Get(":id")
  findOne(@Param("id") id: string) {
    return this.reservationsService.findOne(id);
  }

  @Post(":id/checkout")
  checkout(@Param("id") id: string) {
    return this.reservationsService.checkout(id);
  }

  @Post("expire")
  expirePending() {
    return this.reservationsService.expirePendingReservations();
  }
}
