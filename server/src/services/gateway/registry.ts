import { GatewayConfig, ModelGateway, ProviderDefinition } from './types.js';
import { OpenAICompatibleGateway } from './gateways/openai.js';
import { OllamaGateway } from './gateways/ollama.js';
import { DeepSeekGateway } from './gateways/deepseek.js';
import { OmnirootGateway } from './gateways/omniroot.js';
import { NineRouterGateway } from './gateways/ninerouter.js';

export class ProviderRegistry {
  private providers: Map<string, ModelGateway> = new Map();

  constructor(config: GatewayConfig) {
    this.loadProviders(config.providers);
  }

  private loadProviders(definitions: ProviderDefinition[]) {
    for (const def of definitions) {
      this.validate(def);
      const gateway = this.instantiate(def);
      this.providers.set(def.name, gateway);
    }
  }

  private validate(def: ProviderDefinition) {
    if (!def.name) throw new Error('Provider missing name');
    if (!def.baseUrl) throw new Error(`Provider ${def.name} missing baseUrl`);
    if (!def.model) throw new Error(`Provider ${def.name} missing model`);
    if (def.type !== 'openai' && def.type !== 'ollama' && def.type !== 'deepseek') {
      throw new Error(`Provider ${def.name} has invalid type: ${def.type}`);
    }
  }

  private instantiate(def: ProviderDefinition): ModelGateway {
    if (def.name === 'omniroot') {
      return new OmnirootGateway(def);
    } else if (def.name === 'ninerouter') {
      return new NineRouterGateway(def);
    } else if (def.type === 'deepseek') {
      return new DeepSeekGateway(def);
    } else if (def.type === 'openai') {
      return new OpenAICompatibleGateway(def);
    } else if (def.type === 'ollama') {
      return new OllamaGateway(def);
    }
    throw new Error(`Failed to instantiate provider ${def.name}`);
  }

  public getProvider(name: string): ModelGateway | undefined {
    return this.providers.get(name);
  }

  public getAvailableProviders(): ModelGateway[] {
    return Array.from(this.providers.values());
  }
}
