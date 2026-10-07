import sys, re, json

sys.stdout.reconfigure(encoding='utf-8')
log_path = r'D:\AgenticOS\server\data\today_session.log'

with open(log_path, 'r', encoding='utf-8') as f:
    lines = f.readlines()

# Collect turns
turns = {}
current_turn = None

for line_idx, line in enumerate(lines):
    m = re.search(r'LIVE_TURN_RECEIVED.*?\"TURN_ID\":(\d+).*?\"STT_TEXT\":\"(.*?)\"', line)
    if m:
        t_id = int(m.group(1))
        t_text = m.group(2)
        current_turn = t_id
        if t_id not in turns:
            turns[t_id] = {'id': t_id, 'text': t_text, 'line_idx': line_idx, 'timestamp': line[:24]}

    m_raw = re.search(r'\[TurnEnvelope\] TURN .*?id=(\d+).*?raw=\"(.*?)\" compiledAction=(\S+)', line)
    if m_raw:
        t_id = int(m_raw.group(1))
        if t_id in turns:
            turns[t_id]['action'] = m_raw.group(3)
            turns[t_id]['raw'] = m_raw.group(2)

    m_target = re.search(r'\[UniversalCapabilityRuntime\] Resolved target evidence:.*?\"resolvedWindow\":\"(.*?)\"', line)
    if m_target and current_turn in turns:
        turns[current_turn]['resolvedWindow'] = m_target.group(1)

    m_contam = re.search(r'\[CROSS_TARGET_CONTAMINATION\] Prevented content crossover!.*?error\":(.*)', line)
    if m_contam and current_turn in turns:
        turns[current_turn]['contamination'] = m_contam.group(1)

    m_fail = re.search(r'\[CapabilityDispatcher\] Step \d+ failed.*?failureReason\":\"(.*?)\"', line)
    if m_fail and current_turn in turns:
        turns[current_turn]['failure'] = m_fail.group(1)

    m_tts = re.search(r'\[JRT\] TTS_NORMALIZED_TEXT turn=(\d+).*?text=\"(.*?)\"', line)
    if m_tts:
        t_id = int(m_tts.group(1))
        if t_id in turns:
            turns[t_id]['tts'] = m_tts.group(2)

    m_playout = re.search(r'Synthesizing speech \(playout #(\d+)\):.*?\"meta\":\"(.*?)\"', line)
    if m_playout and current_turn in turns:
        turns[current_turn]['playout_meta'] = m_playout.group(2)

print(f'Total identified turns: {len(turns)}')
for t_id in sorted(turns.keys()):
    t = turns[t_id]
    print(f"\n==================================================")
    print(f"TURN {t_id} @ {t.get('timestamp')}")
    print(f"  STT Text:        {t.get('text')}")
    print(f"  Raw Envelope:    {t.get('raw')}")
    print(f"  Action:          {t.get('action')}")
    print(f"  Resolved Window: {t.get('resolvedWindow')}")
    print(f"  Contamination:   {t.get('contamination')}")
    print(f"  Failure:         {t.get('failure')}")
    print(f"  TTS Response:    {t.get('tts')}")
    print(f"  Playout Meta:    {t.get('playout_meta')}")
