import os
import shutil
import subprocess
import tempfile
import zipfile
import uuid
from pathlib import Path
from datetime import datetime

from django.conf import settings
from django.http import HttpResponse
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
        print(f"Error listing files: {e}")
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
    Take a list of filenames, copy them to a temp dir, run 'mcap recover' directly,
    zip the results, and return the zip file.
    """
    files = request.data.get('files', [])
    if not files or not isinstance(files, list):
        return Response({"error": "Expected { files: string[] }"}, status=status.HTTP_400_BAD_REQUEST)

    base_dir = Path(settings.RECORDINGS_BASE_DIR)
    # SCRIPT_PATH is no longer used

    # Create temp workspace
    job_id = str(uuid.uuid4())
    tmp_root = Path(tempfile.gettempdir()) / f"recoverjob-{job_id}"
    input_dir = tmp_root / "input"
    output_dir = tmp_root / "output"
    
    try:
        input_dir.mkdir(parents=True, exist_ok=True)
        output_dir.mkdir(parents=True, exist_ok=True)
        
        staged_files = []

        # Stage files
        for filename in files:
            try:
                src = resolve_inside(base_dir, filename)
                if not src.exists() or not src.is_file():
                     raise ValueError(f"File not found: {filename}")
                dest = input_dir / Path(filename).name
                shutil.copy2(src, dest)
                staged_files.append(dest)
            except Exception as e:
                shutil.rmtree(tmp_root, ignore_errors=True)
                return Response({"error": str(e)}, status=status.HTTP_400_BAD_REQUEST)
        
        # Run mcap recover on each file
        recovered_files = []
        
        for input_file in staged_files:
            # Input: input/foo.mcap
            # Output: output/foo-rec.mcap
            output_filename = input_file.stem + "-rec" + input_file.suffix
            output_file = output_dir / output_filename
            
            try:
                # mcap recover input.mcap -o output.mcap
                cmd = ["mcap", "recover", str(input_file), "-o", str(output_file)]
                
                proc = subprocess.run(
                    cmd,
                    cwd=str(tmp_root),
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    env=os.environ.copy()
                )
                
                if proc.returncode != 0:
                    # If one fails, we might want to continue or fail hard. 
                    # Let's fail hard for now or log it.
                    error_msg = proc.stderr.decode('utf-8') or "Unknown error"
                    raise RuntimeError(f"mcap recover failed for {input_file.name}: {error_msg}")
                
                if output_file.exists():
                    recovered_files.append(output_file)
                    
            except Exception as e:
                shutil.rmtree(tmp_root, ignore_errors=True)
                return Response({"error": str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

        if not recovered_files:
            shutil.rmtree(tmp_root, ignore_errors=True)
            return Response({"error": "No recovered .mcap files were produced"}, status=status.HTTP_400_BAD_REQUEST)

        # Create Zip
        zip_filename = f"recovered_{datetime.now().strftime('%Y-%m-%d-%H-%M-%S')}.zip"
        zip_path = tmp_root / zip_filename
        
        with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as zf:
            for rf in recovered_files:
                zf.write(rf, arcname=rf.name)
                
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
