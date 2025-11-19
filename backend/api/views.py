import os
import shutil
import subprocess
import tempfile
import zipfile
import uuid
from pathlib import Path
from datetime import datetime

from django.conf import settings
from django.http import HttpResponse, JsonResponse
from rest_framework.decorators import api_view
from rest_framework.response import Response
from rest_framework import status

@api_view(['GET'])
def list_files(request):
    """
    List all .mcap files in the configured BASE_DIR.
    """
    base_dir = Path(settings.RECORDINGS_BASE_DIR)
    
    if not base_dir.exists():
        return Response({"error": f"Directory {base_dir} does not exist"}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

    files_data = []
    try:
        for entry in os.scandir(base_dir):
            if entry.is_file() and entry.name.endswith('.mcap'):
                stat = entry.stat()
                files_data.append({
                    "name": entry.name,
                    "size": stat.st_size,
                    "createdAt": datetime.fromtimestamp(stat.st_ctime).isoformat(),
                    "modifiedAt": datetime.fromtimestamp(stat.st_mtime).isoformat(),
                })
    except Exception as e:
         return Response({"error": str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

    return Response({
        "dir": str(base_dir),
        "files": files_data
    })

def resolve_inside(base, rel):
    base_abs = Path(base).resolve()
    target_abs = (base_abs / rel).resolve()
    if base_abs not in target_abs.parents and base_abs != target_abs:
         raise ValueError("Path traversal detected")
    return target_abs

@api_view(['POST'])
def recover_and_zip(request):
    """
    Take a list of filenames, copy them to a temp dir, run the recovery script,
    zip the results, and return the zip file.
    """
    files = request.data.get('files', [])
    if not files or not isinstance(files, list):
        return Response({"error": "Expected { files: string[] }"}, status=status.HTTP_400_BAD_REQUEST)

    base_dir = Path(settings.RECORDINGS_BASE_DIR)
    script_path = settings.RECOVERY_SCRIPT_PATH

    # Create temp workspace
    job_id = str(uuid.uuid4())
    tmp_root = Path(tempfile.gettempdir()) / f"recoverjob-{job_id}"
    input_dir = tmp_root / "input"
    
    try:
        input_dir.mkdir(parents=True, exist_ok=True)
        
        # Stage files
        for filename in files:
            try:
                src = resolve_inside(base_dir, filename)
                if not src.exists() or not src.is_file():
                     raise ValueError(f"File not found: {filename}")
                shutil.copy2(src, input_dir / Path(filename).name)
            except Exception as e:
                shutil.rmtree(tmp_root, ignore_errors=True)
                return Response({"error": str(e)}, status=status.HTTP_400_BAD_REQUEST)
        
        # Run recovery script
        # Invoking via 'sh' as per previous logic
        try:
            # subprocess.run will block until complete
            proc = subprocess.run(
                ["sh", script_path, str(input_dir)],
                cwd=str(tmp_root),
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                env=os.environ.copy()
            )
            
            if proc.returncode != 0:
                error_msg = proc.stderr.decode('utf-8') or "Unknown error"
                raise RuntimeError(f"Script failed with code {proc.returncode}: {error_msg}")

        except Exception as e:
            shutil.rmtree(tmp_root, ignore_errors=True)
            return Response({"error": f"Recovery script failed: {str(e)}"}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

        # Find recovered files
        recovered_files = list(input_dir.glob("*.mcap"))
        if not recovered_files:
            shutil.rmtree(tmp_root, ignore_errors=True)
            return Response({"error": "No recovered .mcap files were produced"}, status=status.HTTP_400_BAD_REQUEST)

        # Create Zip
        zip_filename = f"recovered_{datetime.now().strftime('%Y-%m-%d-%H-%M-%S')}.zip"
        
        # We'll write the zip to a memory buffer or a temp file. 
        # For large files, streaming is better, but standard HttpResponse supports file-like objects.
        # Let's use a temp file for the zip to be safe with RAM.
        zip_path = tmp_root / zip_filename
        
        with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as zf:
            for rf in recovered_files:
                zf.write(rf, arcname=rf.name)
                
        # Read the zip content to serve it
        # Note: In a real production setup with huge files, you'd want to use FileResponse and 
        # ensure cleanup happens after serving. Django's FileResponse can handle file handles.
        # However, cleaning up the temp dir *after* the response is sent is tricky in basic views.
        # We'll read into memory for simplicity if under memory limits, or use a generator with cleanup.
        # Given the constraints, I'll read to memory, clean up, then send.
        
        with open(zip_path, 'rb') as f:
            zip_data = f.read()
            
        # Cleanup
        shutil.rmtree(tmp_root, ignore_errors=True)
        
        response = HttpResponse(zip_data, content_type='application/zip')
        response['Content-Disposition'] = f'attachment; filename="{zip_filename}"'
        return response

    except Exception as e:
        if tmp_root.exists():
            shutil.rmtree(tmp_root, ignore_errors=True)
        return Response({"error": str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
