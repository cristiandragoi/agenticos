#!/usr/bin/env python3
"""jarvis-corpus-live.py — run the conversational regression corpus against the RUNNING AgenticOS app.

This is the LIVE half of the corpus: the same chains the deterministic test
(server/src/__tests__/jarvisConversationCorpus.test.ts) exercises on the state
machine, but here the observation comes from the real HTTP API + backend log of
the deployed build — an independent client, not the code path under test.

Usage:  python scripts/jarvis-corpus-live.py [--base http://127.0.0.1:4600]

Chains whose expectations need injected conversation state (seeded pending
clarifications / recorded failures) are reported as SKIPPED-LIVE with the reason;
they are enforced by the deterministic corpus test instead.
"""
import argparse, json, os, re, sys, time, urllib.request

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CORPUS = os.path.join(REPO, '.hermes', 'plans', 'jarvis-conversation-corpus.json')
RESULTS = os.path.join(REPO, '.hermes', 'plans', 'jarvis-corpus-live-results.json')
LOG = os.path.join(os.environ.get('APPDATA', ''), 'AgenticOS', '.agentos', 'logs', 'backend-managed.log')

SEEDED = ('chain6_', 'chain7_', 'chain8_', 'chain9_', 'chain12_')


def log_size():
    try:
        return os.path.getsize(LOG)
    except OSError:
        return 0


def log_delta(start):
    try:
        with open(LOG, 'r', encoding='utf-8', errors='replace') as f:
            f.seek(start)
            return f.read()
    except OSError:
        return ''


def post(url, payload, timeout=120):
    req = urllib.request.Request(url, data=json.dumps(payload).encode(),
                                 headers={'Content-Type': 'application/json'}, method='POST')
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode('utf-8', 'replace') or '{}')


def stream_turn(base, conv_id, prompt, tag):
    """Send one turn, return the backend-log slice produced by it."""
    start = log_size()
    body = json.dumps({'prompt': prompt, 'inputChannel': 'typed',
                       'operationId': f'corpus-{tag}-{int(time.time() * 1000)}'}).encode()
    req = urllib.request.Request(f'{base}/api/jarvis/conversations/{conv_id}/message/stream', data=body,
                                 headers={'Content-Type': 'application/json',
                                          'Accept': 'text/event-stream'}, method='POST')
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            while r.read(8192):
                pass
    except Exception as e:                                    # stream errors are still observable
        print(f'    (stream note: {e})')
    time.sleep(0.6)
    return log_delta(start)


def final_text_of(log_slice):
    """The spoken reply for a turn, from the trace the runtime emitted itself.

    The trace arrives in two shapes: a plain console line, or a JSON-escaped
    logger line whose tail carries `\\"}}`. Strip that tail so the transcript
    reports what Jarvis SAID, not how it was logged.
    """
    m = re.findall(r'FINAL_TEXT=(.*)', log_slice)
    if not m:
        m = re.findall(r'FINAL_RESPONSE=(.*)', log_slice)
        if not m:
            return ''
    text = m[-1].strip().replace('\\"', '"').replace('\\n', ' ').replace('\\\\', '\\')
    text = re.sub(r'["\'}\],;]+$', '', text)
    return text.strip()


def check(text, expect):
    fails = []
    for pattern in expect.get('mustMatch', []):
        if not re.search(pattern, text, re.I):
            fails.append(f'must match /{pattern}/')
    for pattern in expect.get('mustNotMatch', []):
        if re.search(pattern, text, re.I):
            fails.append(f'must NOT match /{pattern}/')
    if 'exact' in expect and text != expect['exact']:
        fails.append(f'must equal {expect["exact"]!r}')
    return fails


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--base', default='http://127.0.0.1:4600')
    args = ap.parse_args()

    health = json.loads(urllib.request.urlopen(f'{args.base}/api/health', timeout=10).read())
    build_id = health.get('build', {}).get('buildId')
    print(f'RUNNING buildId = {build_id}   status = {health.get("status")}')

    corpus = json.load(open(CORPUS, encoding='utf-8'))
    results, passed, failed, skipped = [], 0, 0, 0

    for chain in corpus['chains']:
        cid = chain['id']
        if cid.startswith(SEEDED):
            skipped += 1
            results.append({'chain': cid, 'status': 'SKIPPED-LIVE',
                            'reason': 'needs injected conversation state; enforced by the deterministic corpus test'})
            print(f'  SKIP  {cid} (needs injected state)')
            continue

        conv = post(f'{args.base}/api/jarvis/conversations', {'title': f'corpus-{cid}'})
        conv_id = conv.get('id') or (conv.get('conversation') or {}).get('id') or conv.get('conversationId')
        chain_fails, transcript = [], []
        for i, turn in enumerate(chain['turns']):
            log_slice = stream_turn(args.base, conv_id, turn['prompt'], f'{cid}-{i}')
            text = final_text_of(log_slice)
            transcript.append({'prompt': turn['prompt'], 'reply': text})
            if turn.get('expect'):
                chain_fails += [f'turn "{turn["prompt"]}": {f}' for f in check(text, turn['expect'])]

        if chain_fails:
            failed += 1
            results.append({'chain': cid, 'status': 'FAIL', 'failures': chain_fails, 'transcript': transcript})
            print(f'  FAIL  {cid}')
            for f in chain_fails:
                print(f'          {f}')
        else:
            passed += 1
            results.append({'chain': cid, 'status': 'PASS', 'transcript': transcript})
            print(f'  PASS  {cid}')

    summary = f'CORPUS LIVE {"PASS" if failed == 0 else "FAIL"} {passed} passed / {failed} failed / {skipped} skipped-live'
    print(f'\n{summary}')
    json.dump({'buildId': build_id, 'summary': summary, 'passed': passed, 'failed': failed,
               'skippedLive': skipped, 'chains': results},
              open(RESULTS, 'w', encoding='utf-8'), indent=1)
    print(f'results -> {RESULTS}')
    return 1 if failed else 0


if __name__ == '__main__':
    sys.exit(main())
