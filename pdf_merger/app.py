from flask import Flask, render_template, request, jsonify, send_file
from werkzeug.utils import secure_filename
import os
import tempfile
from pypdf import PdfWriter, PdfReader
import uuid
import threading
import time

app = Flask(__name__)
app.config['MAX_CONTENT_LENGTH'] = 100 * 1024 * 1024  # 100MB max total size

UPLOAD_FOLDER = tempfile.gettempdir()
ALLOWED_EXTENSIONS = {'pdf'}
MAX_FILE_SIZE = 20 * 1024 * 1024  # 20MB per file

def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

def validate_pdf(filepath):
    """Validate if file is a proper PDF"""
    try:
        reader = PdfReader(filepath)
        return len(reader.pages) > 0
    except Exception:
        return False

def cleanup_old_files():
    """Clean up files older than 1 hour"""
    current_time = time.time()
    for filename in os.listdir(UPLOAD_FOLDER):
        if filename.startswith(('merged_', 'temp_')):
            filepath = os.path.join(UPLOAD_FOLDER, filename)
            if os.path.isfile(filepath):
                file_age = current_time - os.path.getctime(filepath)
                if file_age > 3600:  # 1 hour
                    try:
                        os.remove(filepath)
                    except OSError:
                        pass

# Start cleanup thread
cleanup_thread = threading.Thread(target=lambda: [cleanup_old_files(), time.sleep(1800)] * 1000, daemon=True)
cleanup_thread.start()

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/upload', methods=['POST'])
def upload_files():
    if 'files' not in request.files:
        return jsonify({'error': 'No files uploaded'}), 400
    
    files = request.files.getlist('files')
    
    if len(files) < 2:
        return jsonify({'error': 'Please upload at least 2 PDF files'}), 400
    
    if len(files) > 10:
        return jsonify({'error': 'Maximum 10 files allowed'}), 400
    
    uploaded_files = []
    
    for file in files:
        if not file or not file.filename:
            return jsonify({'error': 'Invalid file upload'}), 400
            
        if not allowed_file(file.filename):
            return jsonify({'error': f'{file.filename} is not a PDF file'}), 400
        
        # Check file size
        file.seek(0, os.SEEK_END)
        file_size = file.tell()
        file.seek(0)
        
        if file_size > MAX_FILE_SIZE:
            return jsonify({'error': f'{file.filename} exceeds 20MB limit'}), 400
        
        if file_size == 0:
            return jsonify({'error': f'{file.filename} is empty'}), 400
        
        filename = secure_filename(file.filename)
        unique_filename = f"temp_{uuid.uuid4()}_{filename}"
        filepath = os.path.join(UPLOAD_FOLDER, unique_filename)
        
        try:
            file.save(filepath)
            
            # Validate PDF structure
            if not validate_pdf(filepath):
                os.remove(filepath)
                return jsonify({'error': f'{filename} is corrupted or not a valid PDF'}), 400
            
            uploaded_files.append({
                'original_name': filename,
                'temp_name': unique_filename,
                'id': str(uuid.uuid4()),
                'size': file_size
            })
            
        except Exception as e:
            if os.path.exists(filepath):
                os.remove(filepath)
            return jsonify({'error': f'Failed to process {filename}: {str(e)}'}), 500
    
    return jsonify({'files': uploaded_files})

@app.route('/merge', methods=['POST'])
def merge_pdfs():
    data = request.get_json()
    file_order = data.get('file_order', [])
    compress = data.get('compress', False)
    
    if len(file_order) < 2:
        return jsonify({'error': 'Need at least 2 files to merge'}), 400
    
    try:
        writer = PdfWriter()
        total_pages = 0
        
        # Verify all files exist and merge
        for temp_name in file_order:
            filepath = os.path.join(UPLOAD_FOLDER, temp_name)
            if not os.path.exists(filepath):
                return jsonify({'error': f'File {temp_name} not found'}), 400
            
            try:
                reader = PdfReader(filepath)
                for page in reader.pages:
                    writer.add_page(page)
                total_pages += len(reader.pages)
            except Exception as e:
                return jsonify({'error': f'Error reading PDF: {str(e)}'}), 400
        
        # Apply compression if requested
        if compress:
            for page in writer.pages:
                page.compress_content_streams()
        
        output_filename = f"merged_{uuid.uuid4()}.pdf"
        output_path = os.path.join(UPLOAD_FOLDER, output_filename)
        
        with open(output_path, 'wb') as output_file:
            writer.write(output_file)
        
        # Get file size
        file_size = os.path.getsize(output_path)
        
        # Clean up uploaded files
        for temp_name in file_order:
            filepath = os.path.join(UPLOAD_FOLDER, temp_name)
            if os.path.exists(filepath):
                try:
                    os.remove(filepath)
                except OSError:
                    pass  # File might already be deleted
        
        return jsonify({
            'merged_file': output_filename,
            'file_size': file_size,
            'page_count': total_pages,
            'compressed': compress
        })
    
    except Exception as e:
        # Clean up on error
        for temp_name in file_order:
            filepath = os.path.join(UPLOAD_FOLDER, temp_name)
            if os.path.exists(filepath):
                try:
                    os.remove(filepath)
                except OSError:
                    pass
        return jsonify({'error': f'Merge failed: {str(e)}'}), 500

@app.route('/download/<filename>')
def download_file(filename):
    # Security check - only allow downloading merged files
    if not filename.startswith('merged_') or not filename.endswith('.pdf'):
        return jsonify({'error': 'Invalid file'}), 400
    
    filepath = os.path.join(UPLOAD_FOLDER, filename)
    if os.path.exists(filepath):
        try:
            # Schedule file deletion after download
            def delete_after_delay():
                time.sleep(60)  # Wait 1 minute
                try:
                    if os.path.exists(filepath):
                        os.remove(filepath)
                except OSError:
                    pass
            
            threading.Thread(target=delete_after_delay, daemon=True).start()
            
            return send_file(
                filepath, 
                as_attachment=True, 
                download_name='merged_document.pdf',
                mimetype='application/pdf'
            )
        except Exception as e:
            return jsonify({'error': f'Download failed: {str(e)}'}), 500
    
    return jsonify({'error': 'File not found'}), 404

@app.errorhandler(413)
def too_large(e):
    return jsonify({'error': 'File too large. Maximum total size is 100MB'}), 413

@app.errorhandler(500)
def internal_error(e):
    return jsonify({'error': 'Internal server error'}), 500

if __name__ == '__main__':
    app.run(debug=True)