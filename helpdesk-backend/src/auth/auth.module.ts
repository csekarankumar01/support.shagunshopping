import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { DatabaseModule } from '../database/database.module.js';
import { MailModule } from '../mail/mail.module.js';
import { AccountStateService } from './account-state.service.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { JwtAuthGuard } from './jwt-auth.guard.js';
import { RevocationService } from './revocation.service.js';
import { RolesGuard } from './roles.guard.js';
import { SessionService } from './session.service.js';

@Module({
  imports: [
    DatabaseModule,
    MailModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('JWT_SECRET'),
        signOptions: {
          expiresIn: Number(
            config.getOrThrow<string>('JWT_EXPIRES_IN_SECONDS'),
          ),
        },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    SessionService,
    RevocationService,
    AccountStateService,
    JwtAuthGuard,
    RolesGuard,
  ],
  exports: [
    AccountStateService,
    JwtAuthGuard,
    RolesGuard,
    JwtModule,
    SessionService,
    RevocationService,
  ],
})
export class AuthModule {}
