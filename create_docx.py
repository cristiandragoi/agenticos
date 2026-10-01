from docx import Document
import os
import datetime

# Create filename with current date
date_str = datetime.datetime.now().strftime('%Y-%m-%d')
filename = f'Untitled_Document_{date_str}.docx'

# Check if file already exists and append numeric suffix if needed
base_name = f'Untitled_Document_{date_str}'
ext = '.docx'
i = 1
final_path = os.path.join('D:\AgenticOS', filename)

while os.path.exists(final_path):
    filename = f'{base_name}_{i}{ext}'
    final_path = os.path.join('D:\AgenticOS', filename)
    i += 1

# Create a new blank document
doc = Document()

# Save the document
doc.save(final_path)

# Verify the file exists and get its size
if os.path.exists(final_path):
    file_size = os.path.getsize(final_path)
    print(f'Successfully created: {final_path}')
    print(f'File size: {file_size} bytes')
    print(f'Valid .docx file: {final_path.endswith(".docx")}')
else:
    print(f'Failed to create file: {final_path}')