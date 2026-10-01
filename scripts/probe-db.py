import sqlite3
import json
import os

db_path = 'C:/Users/cd-pr/AppData/Roaming/AgenticOS/data/agentic-os.db'
conn = sqlite3.connect(db_path)
cur = conn.cursor()

print('=== TABLES IN DB ===')
cur.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
tables = [row[0] for row in cur.fetchall()]
print(', '.join(tables))

print('\n=== PROJECTS ===')
cur.execute("SELECT id, name, priority, status, revenue_vertical FROM projects")
for r in cur.fetchall():
    print(r)

print('\n=== ACTIVE PROJECT FILE ===')
apf = 'C:/Users/cd-pr/AppData/Roaming/AgenticOS/data/active-project.json'
if os.path.exists(apf):
    with open(apf, 'r', encoding='utf-8') as f:
        print('active-project.json content:', f.read())

print('\n=== REVENUE MISSIONS ===')
try:
    cur.execute("SELECT id, title, status, project_id FROM revenue_missions LIMIT 10")
    for r in cur.fetchall():
        print(r)
except Exception as e:
    print('error:', e)

print('\n=== REVENUE OPPORTUNITIES ===')
try:
    cur.execute("SELECT id, title, stage, overall_score FROM revenue_opportunities LIMIT 10")
    for r in cur.fetchall():
        print(r)
except Exception as e:
    print('error:', e)

print('\n=== REVENUE HUMAN GATES ===')
try:
    cur.execute("SELECT * FROM revenue_human_gates LIMIT 10")
    for r in cur.fetchall():
        print(r)
except Exception as e:
    print('error:', e)

print('\n=== BACKGROUND TASKS (STATUS SUMMARY) ===')
cur.execute("SELECT project_id, status, count(*) FROM background_tasks GROUP BY project_id, status")
for r in cur.fetchall():
    print(r)

print('\n=== PROJECT TASKS (STATUS SUMMARY) ===')
cur.execute("SELECT project_id, status, count(*) FROM project_tasks GROUP BY project_id, status")
for r in cur.fetchall():
    print(r)
