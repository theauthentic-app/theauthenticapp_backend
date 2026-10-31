import { Module } from '@nestjs/common';
import {
  AuthenticationSignalProvider,
  NoopAuthenticationSignalProvider,
} from './ai-signal.provider';
import { RiskSignalsController } from './risk-signals.controller';
import { RiskSignalsService } from './risk-signals.service';

@Module({
  controllers: [RiskSignalsController],
  providers: [
    RiskSignalsService,
    {
      provide: AuthenticationSignalProvider,
      useClass: NoopAuthenticationSignalProvider,
    },
  ],
  exports: [AuthenticationSignalProvider, RiskSignalsService],
})
export class RiskModule {}
