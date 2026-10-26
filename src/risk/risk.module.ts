import { Module } from '@nestjs/common';
import {
  AuthenticationSignalProvider,
  NoopAuthenticationSignalProvider,
} from './ai-signal.provider';

@Module({
  providers: [
    {
      provide: AuthenticationSignalProvider,
      useClass: NoopAuthenticationSignalProvider,
    },
  ],
  exports: [AuthenticationSignalProvider],
})
export class RiskModule {}
