#!/usr/bin/env python3
"""Hermes compression flow instrumentation - captures actual state from DB."""
import json, sqlite3 as sql, os, glob
from datetime import datetime

HERMES_PATH = "C:/Users/cd-pr/AppData/Local/hermes"

def find_hermes_state_db():
    candidate = f"{HERMES_PATH}/state.db"
    if os.path.exists(candidate): return candidate
    pattern = f"{HERMES_PATH}/**/state.db"
    matches = glob.glob(pattern, recursive=True)
    for m in sorted(matches, reverse=True):
        if 'test' not in m.lower() and 'temp' not in m.lower(): return m
    raise FileNotFoundError(f"No state.db found under {HERMES_PATH}")

def diagnose_compression():
    db_path = find_hermes_state_db()
    print(f"State DB: {db_path}\n")
    
    conn = sql.connect(db_path)
    c = conn.cursor()
    
    # Schema inspection - ALREADY DONE, skip for brevity
    
    # Token count aggregation
    print("=== TOKEN COUNT ANALYSIS ===")
    try:
        c.execute("SELECT SUM(token_count) as total FROM messages WHERE token_count IS NOT NULL")
        row = c.fetchone()
        desc = [d[0] for d in c.description]
        rd = dict(zip(desc, row))
        print(f"Total tokens in session: {rd.get('total', 0):,}")
    except Exception as e:
        print(f"Error aggregating tokens: {e}")
    
    try:
        c.execute("SELECT COUNT(*), SUM(token_count) FROM messages WHERE token_count IS NOT NULL")
        row = c.fetchone()
        print(f"Messages with token counts: {row[0]}, total tokens: {row[1] or 0:,}")
    except Exception as e:
        print(f"Error counting messages: {e}")
    
    # All tables with token fields
    tnames = [r[0] for r in c.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()]
    print(f"\n=== ALL TABLES ===")
    for tn in tnames:
        try:
            cols = [col[0] for col in c.execute(f"PRAGMA table_info({tn})").fetchall()]
            has_tokens = any('token' in k.lower() for k in cols)
            print(f"  {tn}{' **HAS TOKENS**' if has_tokens else ''}")
        except: pass
    
    # Compression attempts tables - check ALL compression-related tables
    for attn in ["compression_attempts", "compressed_versions", "compression_history", "session_compression_events"]:
        if attn in tnames:
            print(f"\n=== {attn.upper()} ===")
            try:
                c.execute(f"SELECT * FROM {attn} ORDER BY timestamp DESC LIMIT 3")
                rows = c.fetchall()
                desc = [d[0] for d in c.description]
                for row in rows: 
                    rd = dict(zip(desc, row))
                    # Pretty print first few keys
                    for k,v in list(rd.items())[:5]: print(f"    {k}: {v}")
            except Exception as e: print(f"Error: {e}")
    
    # Compression locks table
    if "compression_locks" in tnames:
        print("\n=== COMPRESSION LOCKS ===")
        c.execute("SELECT * FROM compression_locks")
        for row in (c.fetchall() or [])[-3:]:
            desc = [d[0] for d in c.description]
            rd = dict(zip(desc, row))
            sid = rd.get('session_id') or 'unknown'
            print(f"  Session: {sid}")
            print(f"    holder: {rd.get('holder')}")
            print(f"    created_at: {rd.get('created_at')}")
            if "ttl_at" in rd:
                now = datetime.utcnow().timestamp()
                ttl_ts = float(rd["ttl_at"] or 0)
                status = "EXPIRED" if ttl_ts < now else f"active ({int(ttl_ts-now)}s left)"
                print(f"    TTL: {status}")
    
    # Compression logs in messages - use correct column names (timestamp not created_at)
    try:
        c.execute("SELECT id, timestamp, token_count, content FROM messages WHERE type='system'")
        for row in c.fetchall():
            desc = [d[0] for d in c.description]
            rd = dict(zip(desc, row))
            cont = rd.get('content') or ""
            if "timeout" in cont.lower() or "attempt" in cont.lower() or "compress" in cont.lower():
                print(f"\n=== COMPRESSION LOG TIMESTAMP={rd.get('timestamp')} ===")
                print(f"{cont[:800]}...")
    except: pass
    
    # Check for any rows with _compressed_summary=1
    try:
        c.execute("SELECT id, role, token_count FROM messages WHERE _compressed_summary=1 ORDER BY timestamp DESC LIMIT 5")
        rows = c.fetchall()
        if rows:
            print(f"\n=== COMPRESSED SUMMARIES ===")
            desc = [d[0] for d in c.description]
            for row in rows:
                rd = dict(zip(desc, row))
                print(f"  id={rd['id']} role={rd['role']} tokens={rd.get('token_count', 0)}")
    except Exception as e:
        pass
    
    conn.close()

if __name__ == "__main__":
    diagnose_compression()
