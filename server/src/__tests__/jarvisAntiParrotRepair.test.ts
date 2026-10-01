import {it, expect} from 'vitest';
import {sanitizeDirectResponse} from '../domains/jarvis/groundingGuardrail.js';
it.each(['Understood, operator.', 'Got it, operator.', 'I am ready and standing by...'])('rejects acknowledgement-only capability response: %s', reply => {
const result=sanitizeDirectResponse(reply,{prompt:'Check Revenue Operator.',hasGroundedEvidence:false});
expect(result).toBe('No capability result was produced; this request has not been executed.');
});
