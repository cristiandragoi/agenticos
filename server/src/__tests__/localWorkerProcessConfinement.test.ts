import {describe,it,expect} from 'vitest';
import {toolRegistryBridge} from '../domains/localWorker/toolRegistryBridge.js';
import {executeConfinedProcess} from '../domains/localWorker/processConfinement.js';
import {localWorkerPlanner} from '../domains/localWorker/localWorkerPlanner.js';

describe('worker process capabilities fail closed',()=>{
 it.each(['shell.execute','developer.build','developer.run_tests','terminalExecutor','terminalTool','hardwareProfiler',
 'sandbox','sandbox.execute','terminal.execute','process.spawn','hermes.execute','voice.speak','native.load','module.import',
 'desktop.open_app','desktop.inspect_process','desktop.stop_process','desktop.inspect_port','desktop.inspect_environment',
 'browser.navigate','browser.inspect','unknown'])('refuses %s',async tool=>{
  const result=await toolRegistryBridge.executeTool(tool,{command:'node -e process.exit(0)',executable:process.execPath,args:['--version']});
  expect(result.success).toBe(false); expect(result.verification.verified).toBe(false);
  expect(result.error).toBe('WORKER_CAPABILITY_DISABLED');
 });
 it.each(['git.status','git.diff','git.log','git.branch'])('%s requires independent supervisor enrollment',async tool=>{
  expect((await toolRegistryBridge.executeTool(tool)).error).toBe('GIT_TRUSTED_SUPERVISOR_NOT_ENROLLED');
 });
 it('refuses direct generic executor access',async()=>{
  await expect(executeConfinedProcess({executable:process.execPath,args:['--version']})).rejects.toThrow('GENERIC_PROCESS_EXECUTION_DISABLED');
 });
 it('does not invoke the model gateway for unknown goals',async()=>{
  await expect(localWorkerPlanner.planGoal('do an unspecified task')).rejects.toThrow('WORKER_MODEL_SUPERVISOR_DISABLED');
 });
});
