#!/usr/bin/env python3
"""
Zeluu Knowledge Pipeline — Step 4a: Upload to Google Drive
===========================================================
Uploads raw transcripts and processed chunks to a structured
Google Drive folder hierarchy.

Requires: GOOGLE_SERVICE_ACCOUNT_KEY environment variable (path to JSON key file)
          or GOOGLE_CREDENTIALS_JSON (inline JSON)

Folder structure:
  Zeluu_Knowledge_Base/
    ├── BH/
    │   ├── math/
    │   │   ├── grade_1/
    │   │   ├── grade_2/
    │   │   └── ...
    │   ├── science/
    │   └── english/
    ├── KW/
    ├── ... (other countries)
    └── _processed/
        └── chunks.json
"""

import os
import json
import sys
from google.oauth2 import service_account
from googleapiclient.discovery import build
from googleapiclient.http import MediaFileUpload, MediaInMemoryUpload
from config import COUNTRIES, SUBJECTS, GRADES, DRIVE_ROOT_FOLDER, DRIVE_ROOT_FOLDER_ID

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
TRANSCRIPTS_DIR = os.path.join(SCRIPT_DIR, "transcripts")
CHUNKS_FILE = os.path.join(SCRIPT_DIR, "chunks.json")

# Scopes for Drive API
SCOPES = ["https://www.googleapis.com/auth/drive.file"]


def get_drive_service():
    """Authenticate and return Drive API service."""
    key_file = os.environ.get("GOOGLE_SERVICE_ACCOUNT_KEY")
    creds_json = os.environ.get("GOOGLE_CREDENTIALS_JSON")

    if key_file and os.path.exists(key_file):
        creds = service_account.Credentials.from_service_account_file(key_file, scopes=SCOPES)
    elif creds_json:
        info = json.loads(creds_json)
        creds = service_account.Credentials.from_service_account_info(info, scopes=SCOPES)
    else:
        print("ERROR: Set GOOGLE_SERVICE_ACCOUNT_KEY (path) or GOOGLE_CREDENTIALS_JSON (inline)")
        sys.exit(1)

    return build("drive", "v3", credentials=creds)


def find_or_create_folder(service, name, parent_id=None):
    """Find a folder by name under a parent, or create it."""
    query = f"name='{name}' and mimeType='application/vnd.google-apps.folder' and trashed=false"
    if parent_id:
        query += f" and '{parent_id}' in parents"

    results = service.files().list(q=query, spaces="drive", fields="files(id, name)").execute()
    files = results.get("files", [])

    if files:
        return files[0]["id"]

    # Create folder
    metadata = {
        "name": name,
        "mimeType": "application/vnd.google-apps.folder",
    }
    if parent_id:
        metadata["parents"] = [parent_id]

    folder = service.files().create(body=metadata, fields="id").execute()
    print(f"  Created folder: {name}")
    return folder["id"]


def upload_file(service, filepath, folder_id, filename=None):
    """Upload a file to a Drive folder."""
    if filename is None:
        filename = os.path.basename(filepath)

    # Check if file already exists
    query = f"name='{filename}' and '{folder_id}' in parents and trashed=false"
    results = service.files().list(q=query, spaces="drive", fields="files(id)").execute()

    media = MediaFileUpload(filepath, mimetype="application/json", resumable=True)

    if results.get("files"):
        # Update existing file
        file_id = results["files"][0]["id"]
        service.files().update(fileId=file_id, media_body=media).execute()
        return file_id
    else:
        # Create new file
        metadata = {"name": filename, "parents": [folder_id]}
        file = service.files().create(body=metadata, media_body=media, fields="id").execute()
        return file["id"]


def upload_json_content(service, data, folder_id, filename):
    """Upload JSON data directly to Drive."""
    content = json.dumps(data, ensure_ascii=False, indent=2).encode("utf-8")
    media = MediaInMemoryUpload(content, mimetype="application/json", resumable=True)

    query = f"name='{filename}' and '{folder_id}' in parents and trashed=false"
    results = service.files().list(q=query, spaces="drive", fields="files(id)").execute()

    if results.get("files"):
        file_id = results["files"][0]["id"]
        service.files().update(fileId=file_id, media_body=media).execute()
        return file_id
    else:
        metadata = {"name": filename, "parents": [folder_id]}
        file = service.files().create(body=metadata, media_body=media, fields="id").execute()
        return file["id"]


def run():
    """Main: create folder structure and upload transcripts + chunks."""
    print("Authenticating with Google Drive...")
    service = get_drive_service()

    # Use the user's existing shared Drive folder as root
    root_id = DRIVE_ROOT_FOLDER_ID
    print(f"Root folder ID: {root_id} (existing shared folder)")

    # Create folder structure: country/subject/grade
    folder_ids = {}
    for country_code in COUNTRIES:
        country_id = find_or_create_folder(service, country_code, root_id)
        for subject in SUBJECTS:
            subject_id = find_or_create_folder(service, subject, country_id)
            for grade in GRADES:
                grade_id = find_or_create_folder(service, f"grade_{grade}", subject_id)
                folder_ids[(country_code, subject, grade)] = grade_id

    # Create _processed folder
    processed_id = find_or_create_folder(service, "_processed", root_id)

    # Upload chunks.json to _processed
    if os.path.exists(CHUNKS_FILE):
        print("\nUploading chunks.json...")
        upload_file(service, CHUNKS_FILE, processed_id)
        print("  Done")

    # Upload individual transcripts to appropriate folders
    if os.path.exists(TRANSCRIPTS_DIR):
        transcript_files = [f for f in os.listdir(TRANSCRIPTS_DIR) if f.endswith(".json")]
        print(f"\nUploading {len(transcript_files)} transcript files...")

        uploaded = 0
        for fi, filename in enumerate(transcript_files, 1):
            filepath = os.path.join(TRANSCRIPTS_DIR, filename)

            with open(filepath, "r", encoding="utf-8") as f:
                data = json.load(f)

            tags = data.get("tags", [])
            if not tags:
                # Upload to root/_untagged
                untagged_id = find_or_create_folder(service, "_untagged", root_id)
                upload_file(service, filepath, untagged_id)
            else:
                # Upload to each relevant folder
                uploaded_to = set()
                for tag in tags:
                    key = (tag["country"], tag["subject"], tag["grade"])
                    if key in folder_ids and key not in uploaded_to:
                        upload_file(service, filepath, folder_ids[key])
                        uploaded_to.add(key)

            uploaded += 1
            if fi % 20 == 0 or fi == len(transcript_files):
                print(f"  Uploaded {fi}/{len(transcript_files)}")

    print(f"\nDrive upload complete!")
    print(f"  Root folder ID: {root_id}")
    print(f"  URL: https://drive.google.com/drive/folders/{root_id}")


if __name__ == "__main__":
    run()
