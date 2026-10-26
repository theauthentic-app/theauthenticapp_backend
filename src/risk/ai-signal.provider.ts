export type PackagingAnalysis = {
  suspicious: boolean;
  confidence: number;
  notes: string[];
};

export abstract class AuthenticationSignalProvider {
  abstract analyzePackaging(_image: Buffer): Promise<PackagingAnalysis | null>;
}

export class NoopAuthenticationSignalProvider extends AuthenticationSignalProvider {
  analyzePackaging(image: Buffer): Promise<PackagingAnalysis | null> {
    void image;
    return Promise.resolve(null);
  }
}
