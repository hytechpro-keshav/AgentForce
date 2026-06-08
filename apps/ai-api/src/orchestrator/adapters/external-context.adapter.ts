import { Injectable, Logger } from "@nestjs/common";

import { AppConfigService } from "../../config/app-config.service";
import type {
  CustomerReadScope,
  ExternalContextSignal
} from "../dto/customer-context";

/**
 * Optional external read adapter (ERP / ServiceNow / asset telemetry).
 * Each adapter is config-gated and OFF by default. A disabled adapter
 * is simply skipped; an ENABLED adapter that fails or returns nothing
 * is recorded as a degraded source so the synthesis lowers confidence —
 * it never fails the node.
 */
export interface ExternalContextAdapter {
  readonly name: string;
  isEnabled(): boolean;
  read(scope: CustomerReadScope): Promise<ExternalContextSignal | undefined>;
}

export interface ExternalContextReadResult {
  signals: ExternalContextSignal[];
  /** Names of enabled adapters that failed or returned nothing. */
  degradedSources: string[];
}

/**
 * Default adapter for a not-yet-connected external system. It reports
 * its configured enablement but performs no I/O, so wiring a real
 * connector later is an implementation swap, not an interface change.
 */
export class DisabledExternalContextAdapter implements ExternalContextAdapter {
  constructor(
    readonly name: string,
    private readonly enabled: boolean
  ) {}

  isEnabled(): boolean {
    return this.enabled;
  }

  async read(): Promise<ExternalContextSignal | undefined> {
    return undefined;
  }
}

/**
 * Holds the external context adapters and reads them all for a scope.
 * Adapters are independently config-gated and degrade gracefully: a
 * missing or failing enabled adapter lowers confidence (degraded
 * source) but never throws into the run.
 */
@Injectable()
export class ExternalContextAdapterRegistry {
  private readonly logger = new Logger(ExternalContextAdapterRegistry.name);
  private readonly adapters: ExternalContextAdapter[];

  constructor(config: AppConfigService) {
    const flags = config.orchestrator.customerHistory.externalAdapters;
    // Interfaces + disabled stubs only. Real ERP/ServiceNow/telemetry
    // connectors are intentionally out of scope for this slice.
    this.adapters = [
      new DisabledExternalContextAdapter("erp", flags.erpEnabled),
      new DisabledExternalContextAdapter("servicenow", flags.serviceNowEnabled),
      new DisabledExternalContextAdapter("telemetry", flags.telemetryEnabled)
    ];
  }

  async readAll(scope: CustomerReadScope): Promise<ExternalContextReadResult> {
    const signals: ExternalContextSignal[] = [];
    const degradedSources: string[] = [];
    for (const adapter of this.adapters) {
      if (!adapter.isEnabled()) {
        continue;
      }
      try {
        const signal = await adapter.read(scope);
        if (signal) {
          signals.push(signal);
        } else {
          degradedSources.push(adapter.name);
        }
      } catch {
        this.logger.warn(
          `External context adapter degraded: source=${adapter.name}`
        );
        degradedSources.push(adapter.name);
      }
    }
    return { signals, degradedSources };
  }
}
