export * from './types';

export class SoloCreatorCore {
  constructor(private config: { dbPath?: string; cdpEndpoint?: string } = {}) {
    // 核心中枢初始化
  }

  getVersion(): string {
    return '0.1.0';
  }
}
