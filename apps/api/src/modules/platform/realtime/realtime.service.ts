import { Injectable } from '@nestjs/common';
import type { Namespace, Server } from 'socket.io';

@Injectable()
export class RealtimeService {
  private consultationNamespace?: Namespace;
  private ambulanceNamespace?: Namespace;
  private rootServer?: Server;

  registerConsultationServer(ns: Namespace) {
    this.consultationNamespace = ns;
    if ((ns as any).server) {
      this.rootServer = (ns as any).server;
    }
  }

  registerAmbulanceServer(ns: Namespace) {
    this.ambulanceNamespace = ns;
    if ((ns as any).server) {
      this.rootServer = (ns as any).server;
    }
  }

  emitToUser(userId: string, event: string, payload: unknown) {
    if (this.consultationNamespace) {
      this.consultationNamespace.to(`user:${userId}`).emit(event, payload);
    }
    if (this.ambulanceNamespace) {
      this.ambulanceNamespace.to(`user:${userId}`).emit(event, payload);
    }
    if (this.rootServer) {
      this.rootServer.to(`user:${userId}`).emit(event, payload);
    }
  }

  emitToConsultationRoom(appointmentId: string, event: string, payload: unknown) {
    if (this.consultationNamespace) {
      this.consultationNamespace.to(`consult:${appointmentId}`).emit(event, payload);
    }
  }

  emitToAmbulanceRoom(requestId: string, event: string, payload: unknown) {
    if (this.ambulanceNamespace) {
      this.ambulanceNamespace.to(`ambulance:${requestId}`).emit(event, payload);
    }
  }
}
