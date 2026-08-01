import { OpenAICompatibleGateway } from './openai.js';
import { ProviderDefinition } from '../types.js';

export class NineRouterGateway extends OpenAICompatibleGateway {
  constructor(def: ProviderDefinition) {
    super(def);
  }
}
