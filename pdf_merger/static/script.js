let uploadedFiles = [];
let sortable = null;
let mergedFileName = null;

// PDF.js worker setup
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

document.addEventListener('DOMContentLoaded', function() {
    const uploadArea = document.getElementById('uploadArea');
    const fileInput = document.getElementById('fileInput');
    const filesSection = document.getElementById('filesSection');
    const filesList = document.getElementById('filesList');
    const mergeBtn = document.getElementById('mergeBtn');
    const compressBtn = document.getElementById('compressBtn');
    const clearBtn = document.getElementById('clearBtn');
    const downloadSection = document.getElementById('downloadSection');
    const downloadBtn = document.getElementById('downloadBtn');
    const newMergeBtn = document.getElementById('newMergeBtn');
    const loading = document.getElementById('loading');
    const fileCounter = document.getElementById('fileCounter');
    const uploadStats = document.getElementById('uploadStats');
    const fileCount = document.getElementById('fileCount');

    // Upload area handlers
    uploadArea.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', handleFileSelect);
    uploadArea.addEventListener('dragover', handleDragOver);
    uploadArea.addEventListener('dragleave', handleDragLeave);
    uploadArea.addEventListener('drop', handleFileDrop);

    // Button handlers
    mergeBtn.addEventListener('click', () => mergePDFs(false));
    compressBtn.addEventListener('click', () => mergePDFs(true));
    clearBtn.addEventListener('click', clearFiles);
    newMergeBtn.addEventListener('click', clearFiles);

    function handleFileSelect(e) {
        const files = Array.from(e.target.files);
        uploadFiles(files);
    }

    function handleDragOver(e) {
        e.preventDefault();
        uploadArea.classList.add('dragover');
    }

    function handleDragLeave(e) {
        e.preventDefault();
        uploadArea.classList.remove('dragover');
    }

    function handleFileDrop(e) {
        e.preventDefault();
        uploadArea.classList.remove('dragover');
        const files = Array.from(e.dataTransfer.files);
        uploadFiles(files);
    }

    function uploadFiles(files) {
        // Validate file count
        if (files.length < 2) {
            showError('Please select at least 2 PDF files');
            return;
        }

        // Validate file types and sizes
        const maxSize = 20 * 1024 * 1024; // 20MB
        const validFiles = [];

        for (const file of files) {
            if (file.type !== 'application/pdf') {
                showError(`${file.name} is not a PDF file`);
                return;
            }
            if (file.size > maxSize) {
                showError(`${file.name} exceeds 20MB limit`);
                return;
            }
            validFiles.push(file);
        }

        // Update upload stats
        fileCount.textContent = validFiles.length;
        uploadStats.style.display = 'block';

        const formData = new FormData();
        validFiles.forEach(file => formData.append('files', file));

        showLoading(true, 'Uploading files...', 30);

        fetch('/upload', {
            method: 'POST',
            body: formData
        })
        .then(response => response.json())
        .then(data => {
            showLoading(false);
            if (data.error) {
                showError(data.error);
            } else {
                uploadedFiles = data.files;
                displayFiles();
                filesSection.style.display = 'block';
                filesSection.classList.add('fade-in');
                downloadSection.style.display = 'none';
                uploadStats.style.display = 'none';
            }
        })
        .catch(error => {
            showLoading(false);
            showError('Upload failed: ' + error.message);
        });
    }

    async function displayFiles() {
        filesList.innerHTML = '';
        fileCounter.textContent = uploadedFiles.length;

        for (let i = 0; i < uploadedFiles.length; i++) {
            const file = uploadedFiles[i];
            const li = document.createElement('li');
            li.className = 'file-item';
            li.dataset.tempName = file.temp_name;
            
            // Create thumbnail
            const thumbnail = await createThumbnail(file.temp_name);
            
            li.innerHTML = `
                <div class="file-thumbnail">
                    ${thumbnail}
                </div>
                <div class="file-info">
                    <div class="file-name">${file.original_name}</div>
                    <div class="file-details">
                        <span>PDF Document</span>
                        <span>Page 1 preview</span>
                    </div>
                </div>
                <div class="file-actions">
                    <button class="file-action-btn" onclick="removeFile('${file.temp_name}')" title="Remove file">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
                <div class="drag-handle">
                    <i class="fas fa-grip-vertical"></i>
                </div>
            `;

            filesList.appendChild(li);
        }

        // Initialize SortableJS
        if (sortable) {
            sortable.destroy();
        }
        
        sortable = new Sortable(filesList, {
            animation: 300,
            ghostClass: 'sortable-ghost',
            dragClass: 'sortable-drag',
            handle: '.drag-handle',
            onEnd: function(evt) {
                // Update the uploadedFiles array based on new order
                const newOrder = Array.from(filesList.children).map(li => 
                    li.dataset.tempName
                );
                
                uploadedFiles = newOrder.map(tempName => 
                    uploadedFiles.find(file => file.temp_name === tempName)
                );
            }
        });
    }

    async function createThumbnail(tempName) {
        try {
            // For demo purposes, we'll show a PDF icon
            // In a real implementation, you'd fetch the PDF and render the first page
            return '<i class="fas fa-file-pdf"></i>';
        } catch (error) {
            return '<i class="fas fa-file-pdf"></i>';
        }
    }

    window.removeFile = function(tempName) {
        uploadedFiles = uploadedFiles.filter(file => file.temp_name !== tempName);
        
        if (uploadedFiles.length < 2) {
            clearFiles();
        } else {
            displayFiles();
        }
    };

    function mergePDFs(compress = false) {
        if (uploadedFiles.length < 2) {
            showError('Need at least 2 files to merge');
            return;
        }

        const actionText = compress ? 'Merging & compressing PDFs...' : 'Merging PDFs...';
        showLoading(true, actionText, 60);

        const fileOrder = uploadedFiles.map(file => file.temp_name);

        fetch('/merge', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ 
                file_order: fileOrder,
                compress: compress 
            })
        })
        .then(response => response.json())
        .then(data => {
            showLoading(false);
            if (data.error) {
                showError(data.error);
            } else {
                mergedFileName = data.merged_file;
                showSuccess(data);
            }
        })
        .catch(error => {
            showLoading(false);
            showError('Merge failed: ' + error.message);
        });
    }

    function showSuccess(data) {
        filesSection.style.display = 'none';
        downloadSection.style.display = 'block';
        downloadSection.classList.add('slide-up');
        
        // Update file info if available
        const fileInfo = document.getElementById('fileInfo');
        if (data.file_size && data.page_count) {
            fileInfo.innerHTML = `
                <span class="file-size">${formatFileSize(data.file_size)}</span> • 
                <span class="file-pages">${data.page_count} pages</span>
            `;
        }

        downloadBtn.onclick = () => {
            window.location.href = `/download/${mergedFileName}`;
        };
    }

    function clearFiles() {
        uploadedFiles = [];
        mergedFileName = null;
        filesSection.style.display = 'none';
        downloadSection.style.display = 'none';
        uploadStats.style.display = 'none';
        fileInput.value = '';
        
        if (sortable) {
            sortable.destroy();
            sortable = null;
        }
    }

    function showLoading(show, text = 'Processing PDFs...', progress = 0) {
        const loadingTitle = document.getElementById('loadingTitle');
        const loadingText = document.getElementById('loadingText');
        const progressFill = document.getElementById('progressFill');
        
        loading.style.display = show ? 'block' : 'none';
        
        if (show) {
            loadingTitle.textContent = text;
            loadingText.textContent = 'Please wait while we process your files';
            progressFill.style.width = progress + '%';
            
            // Animate progress
            setTimeout(() => {
                progressFill.style.width = '100%';
            }, 500);
            
            filesSection.style.display = 'none';
            downloadSection.style.display = 'none';
        }
    }

    function showError(message) {
        // Create a temporary error notification
        const errorDiv = document.createElement('div');
        errorDiv.className = 'error-notification';
        errorDiv.innerHTML = `
            <i class="fas fa-exclamation-triangle"></i>
            <span>${message}</span>
        `;
        
        // Add error styles
        errorDiv.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: rgba(220, 38, 127, 0.9);
            color: white;
            padding: 15px 20px;
            border-radius: 12px;
            display: flex;
            align-items: center;
            gap: 10px;
            z-index: 10000;
            backdrop-filter: blur(10px);
            border: 1px solid rgba(220, 38, 127, 0.3);
            animation: slideIn 0.3s ease-out;
        `;
        
        document.body.appendChild(errorDiv);
        
        // Remove after 5 seconds
        setTimeout(() => {
            errorDiv.style.animation = 'slideOut 0.3s ease-out';
            setTimeout(() => {
                if (errorDiv.parentNode) {
                    errorDiv.parentNode.removeChild(errorDiv);
                }
            }, 300);
        }, 5000);
    }

    function formatFileSize(bytes) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    // Add CSS for error notifications
    const style = document.createElement('style');
    style.textContent = `
        @keyframes slideIn {
            from {
                transform: translateX(100%);
                opacity: 0;
            }
            to {
                transform: translateX(0);
                opacity: 1;
            }
        }
        
        @keyframes slideOut {
            from {
                transform: translateX(0);
                opacity: 1;
            }
            to {
                transform: translateX(100%);
                opacity: 0;
            }
        }
        
        .sortable-ghost {
            opacity: 0.3;
        }
    `;
    document.head.appendChild(style);
});