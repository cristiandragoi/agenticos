import os
import shutil

# Cleanup of S2-research artifacts only. Nothing here is under a production root.
targets = [
    r"D:/c/Users",  # created by an MSYS-path mishap this pass; D:/c parent pre-existed
    r"C:/Users/cd-pr/AppData/Local/Temp/fc-r4-research-red",
    r"C:/Users/cd-pr/AppData/Local/Temp/fc-r4-research-green",
]
for p in targets:
    if os.path.exists(p):
        shutil.rmtree(p)
        print("removed", p)
    else:
        print("absent", p)
print("D:/c now:", os.listdir(r"D:/c") if os.path.exists(r"D:/c") else "gone")
