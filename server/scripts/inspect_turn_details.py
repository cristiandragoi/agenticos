import sys, re

sys.stdout.reconfigure(encoding='utf-8')
log_path = r'D:\AgenticOS\server\data\today_session.log'

with open(log_path, 'r', encoding='utf-8') as f:
    lines = f.readlines()

def print_turn_range(start_pat, end_pat=None, max_lines=200):
    capturing = False
    count = 0
    for line in lines:
        if re.search(start_pat, line):
            capturing = True
            print(f"\n>>>>>>>>>> START: {start_pat} >>>>>>>>>>")
        if capturing:
            print(line.rstrip())
            count += 1
            if end_pat and re.search(end_pat, line) and count > 5:
                print(f"<<<<<<<<<< END: {end_pat} <<<<<<<<<<\n")
                break
            if count >= max_lines:
                print("... truncated ...")
                break

print("=== INSPECTING TURN 6 ===")
print_turn_range(r'LIVE_TURN_RECEIVED.*?\"TURN_ID\":6\b', r'TURN_COMPLETE turn=6', 150)

print("\n=== INSPECTING TURN 10 ===")
print_turn_range(r'LIVE_TURN_RECEIVED.*?\"TURN_ID\":10\b', r'TURN_COMPLETE turn=10', 150)

print("\n=== INSPECTING TURN 12 ===")
print_turn_range(r'LIVE_TURN_RECEIVED.*?\"TURN_ID\":12\b', r'TURN_COMPLETE turn=12', 150)

print("\n=== INSPECTING AFTER TURN 19 UNTIL END ===")
print_turn_range(r'LIVE_TURN_RECEIVED.*?\"TURN_ID\":19\b', None, 300)
