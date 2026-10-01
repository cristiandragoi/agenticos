// READ-ONLY forensic probe: list LiveKit rooms/participants/tracks. No app code touched.
import { RoomServiceClient } from 'livekit-server-sdk';

const host = 'http://127.0.0.1:7880';
const svc = new RoomServiceClient(host, 'devkey', 'secret');

const stamp = () => new Date().toISOString();

try {
  const rooms = await svc.listRooms();
  console.log(`[${stamp()}] ROOMS: ${rooms.length}`);
  for (const r of rooms) {
    console.log(`  ROOM name=${r.name} sid=${r.sid} numParticipants=${r.numParticipants} numPublishers=${r.numPublishers} creationTime=${r.creationTime}`);
    const parts = await svc.listParticipants(r.name);
    console.log(`  PARTICIPANTS: ${parts.length}`);
    for (const p of parts) {
      console.log(`    - identity=${p.identity} sid=${p.sid} state=${p.state} joinedAt=${p.joinedAt} isPublisher=${p.isPublisher} permission.canSubscribe=${p.permission?.canSubscribe}`);
      for (const t of p.tracks || []) {
        console.log(`        TRACK sid=${t.sid} type=${t.type} source=${t.source} name=${t.name} muted=${t.muted} mimeType=${t.mimeType} disableDtx=${t.disableDtx} stereo=${t.stereo} version=${JSON.stringify(t.version ?? null)}`);
      }
    }
  }
  if (rooms.length === 0) console.log('  (no active rooms)');
} catch (err) {
  console.error('PROBE_ERROR:', err?.message || err);
  process.exitCode = 1;
}
