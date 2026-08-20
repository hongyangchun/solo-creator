import { PublishResult, UnifiedPayload, PayloadType, DriverType, ChannelType } from '../types';

export interface PlatformDriver {
  readonly id: string;
  readonly channel: ChannelType;
  readonly driverType: DriverType;
  readonly priority: number;
  isAvailable(): Promise<boolean>;
  supportsPayload(payloadType: PayloadType): boolean;
  publish(payload: UnifiedPayload, options?: { draftOnly?: boolean }): Promise<PublishResult>;
}

export type PreferredDriver = 'auto' | DriverType;

export class PublisherRegistry {
  private drivers: PlatformDriver[] = [];

  register(driver: PlatformDriver): void {
    this.drivers.push(driver);
  }

  listDrivers(channel?: ChannelType): PlatformDriver[] {
    return channel ? this.drivers.filter((d) => d.channel === channel) : this.drivers;
  }

  async dispatch(
    channel: ChannelType,
    payload: UnifiedPayload,
    options?: { preferred?: PreferredDriver; draftOnly?: boolean }
  ): Promise<PublishResult> {
    // 1. 筛选支持该渠道且支持该 Payload 类型的驱动
    let candidates = this.drivers
      .filter((d) => d.channel === channel && d.supportsPayload(payload.type))
      .sort((a, b) => a.priority - b.priority);

    if (options?.preferred && options.preferred !== 'auto') {
      candidates = candidates.filter((d) => d.driverType === options.preferred);
    }

    if (candidates.length === 0) {
      throw new Error(`渠道 ${channel} 没有可用的驱动支持 Payload 类型: ${payload.type}`);
    }

    // 2. 循环探测：首个可用驱动执行，失败自动降级
    let lastError: Error | null = null;
    for (const driver of candidates) {
      const available = await driver.isAvailable();
      if (!available) {
        console.warn(`[PublisherRegistry] 驱动 ${driver.id} 环境不可用，尝试降级下一个...`);
        continue;
      }
      try {
        return await driver.publish(payload, { draftOnly: options?.draftOnly ?? true });
      } catch (err: any) {
        lastError = err;
        console.warn(`[PublisherRegistry] 驱动 ${driver.id} 执行失败: ${err.message}，自动降级...`);
      }
    }

    return {
      success: false,
      channel,
      driverId: 'none',
      driverType: 'cdp',
      mode: 'draft',
      errorMessage: lastError?.message || '所有候选驱动均不可用',
      timestamp: new Date().toISOString()
    };
  }
}
