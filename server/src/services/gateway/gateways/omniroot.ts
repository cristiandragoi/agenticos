import { OpenAICompatibleGateway } from './openai.js';
import { ProviderDefinition } from '../types.js';

export class OmnirootGateway extends OpenAICompatibleGateway {
  constructor(def: ProviderDefinition) {
    super(def);
  }
}
