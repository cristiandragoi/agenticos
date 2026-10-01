import Database from 'better-sqlite3';
import { runBoundedE2EMission } from '../src/services/revenueOperator/revenueMissionRunner.js';

async function recover() {
  const dbPath = 'C:\\Users\\cd-pr\\AppData\\Roaming\\AgenticOS\\data\\agentic-os.db';
  const db = new Database(dbPath);

  console.log('[Recovery] Updating bgtask-352e2bf60 to running...');
  db.prepare(`
    UPDATE background_tasks
    SET status = 'running',
        blocker = null,
        current_stage = 'executing_mission',
        progress_message = 'Resuming bounded DEV revenue mission for Free Cash (muc9hp11)...',
        updated_at = ?
    WHERE task_id = 'bgtask-352e2bf60'
  `).run(new Date().toISOString());

  console.log('[Recovery] Running runBoundedE2EMission({ resumeMissionId: "mission-51b98315-" })...');
  const trace = await runBoundedE2EMission({ resumeMissionId: 'mission-51b98315-' });
  console.log('[Recovery] Trace result:', JSON.stringify(trace, null, 2));

  if (trace.status === 'success' || trace.steps.every(s => s.ok)) {
    console.log('[Recovery] Mission succeeded! Marking bgtask-352e2bf60 as completed...');
    const resultText = `Revenue Operator completed mission ${trace.missionId}. Strategy run: ${trace.strategyRunId || 'none'}. Experiment: ${trace.experimentId || 'none'}. Next action: ${trace.nextAction || 'none'}. Bounded DEV revenue mission (internal planning) verified.`;
    db.prepare(`
      UPDATE background_tasks
      SET status = 'completed',
          current_stage = 'completed',
          verification_state = 'verified',
          result_text = ?,
          progress_message = 'Revenue Operator completed mission mission-51b98315- (Free Cash).',
          completed_at = ?,
          updated_at = ?
      WHERE task_id = 'bgtask-352e2bf60'
    `).run(resultText, new Date().toISOString(), new Date().toISOString());

    // Update board card if exists
    try {
      db.prepare(`
        UPDATE board_cards
        SET column_id = 'done',
            updated_at = ?
        WHERE card_id = 'puw1i6zi5x'
      `).run(new Date().toISOString());
      console.log('[Recovery] Board card puw1i6zi5x moved to done');
    } catch (e: any) {
      console.log('[Recovery] Note on board card:', e?.message);
    }

    console.log('[Recovery] Recovery finished successfully!');
  } else {
    console.error('[Recovery] Mission was not successful:', trace);
  }

  db.close();
}

recover().catch(err => {
  console.error('[Recovery] Fatal error:', err);
  process.exit(1);
});
