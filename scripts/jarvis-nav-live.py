#!/usr/bin/env python3
"""jarvis-nav-live.py — D14 live navigation harness.

Drives the REAL typed chat endpoint and behaves like the GUI client:
it reads the stream, receives the canonical `navigation_request` packet, ACKs
proven state to POST /api/jarvis/navigation/ack, and reports what the server did.

Modes
  pass  — ACK the requested route + requested project (a correctly-behaving GUI)
  fail  — ACK the right route but the WRONG project (must not verify)
  none  — never ACK (must time out and never claim success)
"""
import argparse, json, sys, time, urllib.request, urllib.error

BASE = 'http://127.0.0.1:4600'


def open_conversation(title):
    req = urllib.request.Request(f'{BASE}/api/jarvis/conversations',
                                 data=json.dumps({'title': title}).encode(),
                                 headers={'Content-Type': 'application/json'}, method='POST')
    with urllib.request.urlopen(req, timeout=20) as r:
        body = json.loads(r.read().decode('utf-8', 'replace') or '{}')
    return body.get('id') or (body.get('conversation') or {}).get('id') or body.get('conversationId')


def post_ack(payload):
    req = urllib.request.Request(f'{BASE}/api/jarvis/navigation/ack',
                                 data=json.dumps(payload).encode(),
                                 headers={'Content-Type': 'application/json'}, method='POST')
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            return json.loads(r.read().decode('utf-8', 'replace') or '{}')
    except urllib.error.HTTPError as e:
        return {'httpError': e.code, 'body': e.read().decode('utf-8', 'replace')[:200]}


def run_turn(conv_id, prompt, mode):
    """Stream one turn, behaving like the GUI client. Returns collected evidence."""
    ev = {'prompt': prompt, 'packet': None, 'ack_response': None, 'reply': ''}
    body = json.dumps({'prompt': prompt, 'inputChannel': 'typed',
                       'operationId': f'd14-{mode}-{int(time.time()*1000)}'}).encode()
    req = urllib.request.Request(f'{BASE}/api/jarvis/conversations/{conv_id}/message/stream',
                                 data=body, headers={'Content-Type': 'application/json',
                                                     'Accept': 'text/event-stream'}, method='POST')
    with urllib.request.urlopen(req, timeout=120) as r:
        buf = b''
        for chunk in r:
            buf += chunk
            while b'\n\n' in buf:
                raw, buf = buf.split(b'\n\n', 1)
                text = raw.decode('utf-8', 'replace')
                name = data = None
                for line in text.splitlines():
                    if line.startswith('event:'):
                        name = line[6:].strip()
                    elif line.startswith('data:'):
                        data = line[5:].strip()
                try:
                    data = json.loads(data) if data else None
                except Exception:
                    pass

                if name == 'navigation_request' and data:
                    ev['packet'] = data
                    if mode == 'none':
                        continue  # deliberately never ACK
                    ack = {
                        'navId': data.get('navId'),
                        'success': True,
                        'actualRoute': data.get('targetRoute'),
                        'activeProjectId': ('proj-wrong-project' if mode == 'fail' else data.get('entityId')),
                        'visibleEntityId': data.get('entityId'),
                    }
                    ev['ack_response'] = post_ack(ack)
                if name in ('chunk', 'final', 'assistant_text') and isinstance(data, dict):
                    ev['reply'] += data.get('text') or data.get('delta') or ''
                if name == 'done':
                    break
    return ev


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--mode', choices=['pass', 'fail', 'none'], default='pass')
    ap.add_argument('--prompt', default='Jarvis, open Free Cash.')
    ap.add_argument('--follow-up', default=None)
    args = ap.parse_args()

    health = json.loads(urllib.request.urlopen(f'{BASE}/api/health', timeout=10).read())
    print(f"build={health.get('build', {}).get('buildId')}  mode={args.mode}")

    conv = open_conversation(f'd14-{args.mode}')
    print(f'CONVERSATION ID: {conv}')

    for prompt in [args.prompt] + ([args.follow_up] if args.follow_up else []):
        ev = run_turn(conv, prompt, args.mode)
        pkt = ev['packet'] or {}
        print(f'\nPROMPT: {prompt}')
        print(f"  NAV ID:          {pkt.get('navId')}")
        print(f"  TRANSPORT:       {pkt.get('source')} (SSE navigation_request)")
        print(f"  REQUESTED ROUTE: {pkt.get('targetRoute')}")
        print(f"  ENTITY:          {pkt.get('entityId')} / {pkt.get('entityName')}")
        print(f"  CLIENT RECEIVED: {'YES' if pkt else 'NO'}")
        ack = ev['ack_response'] or {}
        print(f"  ACK RESPONSE:    accepted={ack.get('accepted')} verified={ack.get('verified')} reason={ack.get('reason')}")
        print(f"  FINAL RESPONSE:  {ev['reply'].strip()[:220]!r}")


if __name__ == '__main__':
    sys.exit(main())
