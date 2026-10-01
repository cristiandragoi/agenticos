import { cameraPerceptionService } from '../dist/services/perception/CameraPerceptionService.js';

async function testCamera() {
  console.log('--- TESTING CAMERA PERCEPTION SERVICE ---');
  const status = cameraPerceptionService.getStatus();
  console.log('Status:', status);

  const devices = await cameraPerceptionService.enumerateDevices();
  console.log('Devices:', devices);

  const res = await cameraPerceptionService.perceive('Can you see me?');
  console.log('Perception result:', JSON.stringify(res, null, 2));
}

testCamera().catch(err => {
  console.error('Camera test error:', err);
});
