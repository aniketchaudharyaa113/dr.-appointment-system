import { Module } from '@nestjs/common';
import { PaymentsModule } from '../payments/payments.module';
import { DoctorService } from './services/doctor.service';
import { SlotService } from './services/slot.service';
import { BookingService } from './services/booking.service';
import { LeaveService } from './services/leave.service';
import { WaitlistService } from './services/waitlist.service';
import { DoctorController } from './controllers/doctor.controller';
import { AppointmentController } from './controllers/appointment.controller';
import { WaitlistController } from './controllers/waitlist.controller';

@Module({
  imports: [PaymentsModule],
  controllers: [
    DoctorController,
    AppointmentController,
    WaitlistController,
  ],
  providers: [
    DoctorService,
    SlotService,
    BookingService,
    LeaveService,
    WaitlistService,
  ],
  exports: [
    DoctorService,
    SlotService,
    BookingService,
    LeaveService,
    WaitlistService,
  ],
})
export class SchedulingModule {}
