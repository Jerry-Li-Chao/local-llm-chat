export function createMediaManager({
  elements,
  state,
  SpeechRecognition,
  setVoiceState,
}) {
  function appendTranscript(text) {
    const transcript = text.trim();
    const current = elements.promptInput.value.trim();

    if (!transcript) {
      return;
    }

    elements.promptInput.value = current ? `${transcript} ${current}` : transcript;
    elements.promptInput.focus();
  }

  function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();

      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(reader.error || new Error(`Could not read ${file.name}.`));
      reader.readAsDataURL(file);
    });
  }

  async function fileToAttachment(file) {
    const dataUrl = await readFileAsDataUrl(file);
    const commaIndex = dataUrl.indexOf(',');

    if (commaIndex === -1) {
      throw new Error(`Invalid image data for ${file.name}.`);
    }

    return {
      name: file.name,
      mimeType: file.type || 'image/png',
      previewUrl: dataUrl,
      data: dataUrl.slice(commaIndex + 1),
    };
  }

  function renderPendingImages() {
    const list = elements.imagePreviewList;
    list.innerHTML = '';

    if (!state.pendingImages.length) {
      list.hidden = true;
      return;
    }

    list.hidden = false;

    state.pendingImages.forEach((image, index) => {
      const card = document.createElement('div');
      card.className = 'image-preview-card';

      const thumbnail = document.createElement('img');
      thumbnail.className = 'image-preview-thumb';
      thumbnail.src = image.previewUrl;
      thumbnail.alt = image.name || `Image ${index + 1}`;

      const label = document.createElement('span');
      label.className = 'image-preview-label';
      label.textContent = image.name || `Image ${index + 1}`;

      const removeButton = document.createElement('button');
      removeButton.type = 'button';
      removeButton.className = 'image-preview-remove';
      removeButton.dataset.imageIndex = String(index);
      removeButton.setAttribute('aria-label', `Remove ${image.name || 'image'}`);
      removeButton.title = 'Remove image';
      removeButton.textContent = 'x';

      card.append(thumbnail, label, removeButton);
      list.appendChild(card);
    });
  }

  async function handleImageSelection(files) {
    const imageFiles = [...files].filter((file) => file.type.startsWith('image/'));

    if (!imageFiles.length) {
      return;
    }

    try {
      const attachments = await Promise.all(imageFiles.map(fileToAttachment));
      state.pendingImages.push(...attachments);
      renderPendingImages();
    } catch (error) {
      console.error('Unable to load selected images.', error);
    } finally {
      elements.imageInput.value = '';
    }
  }

  function removePendingImage(index) {
    state.pendingImages.splice(index, 1);
    renderPendingImages();
  }

  function openImageLightbox(src, alt = '') {
    if (!src) {
      return;
    }

    elements.imageLightboxImage.src = src;
    elements.imageLightboxImage.alt = alt;
    elements.imageLightbox.hidden = false;
    document.body.classList.add('lightbox-open');
  }

  function closeImageLightbox() {
    if (!elements.imageLightbox || !elements.imageLightboxImage) {
      return;
    }

    elements.imageLightbox.hidden = true;
    elements.imageLightboxImage.src = '';
    elements.imageLightboxImage.alt = '';
    document.body.classList.remove('lightbox-open');
  }

  function setDropzoneActive(isActive) {
    elements.promptDropzone?.classList.toggle('drag-active', isActive);
  }

  function hasImageFiles(dataTransfer) {
    if (!dataTransfer) {
      return false;
    }

    return [...(dataTransfer.items || [])].some((item) => item.kind === 'file' && item.type.startsWith('image/'))
      || [...(dataTransfer.files || [])].some((file) => file.type.startsWith('image/'));
  }

  function teardownMeter() {
    if (state.audioMeterFrame) {
      window.cancelAnimationFrame(state.audioMeterFrame);
      state.audioMeterFrame = null;
    }

    if (state.audioContext) {
      state.audioContext.close().catch(() => {});
      state.audioContext = null;
    }

    if (state.mediaStream) {
      state.mediaStream.getTracks().forEach((track) => track.stop());
      state.mediaStream = null;
    }

    elements.meterBar.style.width = '6%';
  }

  async function setupMeter() {
    teardownMeter();

    const mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const audioContext = new AudioContext();
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 256;

    const source = audioContext.createMediaStreamSource(mediaStream);
    source.connect(analyser);

    const data = new Uint8Array(analyser.frequencyBinCount);

    state.mediaStream = mediaStream;
    state.audioContext = audioContext;

    const render = () => {
      analyser.getByteFrequencyData(data);
      const average = data.reduce((sum, value) => sum + value, 0) / data.length;
      const width = Math.max(6, Math.min(100, average / 1.8));
      elements.meterBar.style.width = `${width}%`;
      state.audioMeterFrame = window.requestAnimationFrame(render);
    };

    render();
  }

  function stopRecording() {
    if (state.recognition && state.isRecording) {
      state.recognition.stop();
    }

    state.isRecording = false;
    setVoiceState('Idle', 'idle');
    elements.voiceHint.textContent = 'Press the mic, speak naturally, then send the transcribed prompt.';
    elements.micButton.textContent = 'Start mic';
    teardownMeter();
  }

  function createRecognition() {
    if (!SpeechRecognition) {
      return null;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    recognition.onresult = (event) => {
      let interim = '';

      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        const transcript = result[0].transcript.trim();

        if (!transcript) {
          continue;
        }

        if (result.isFinal) {
          appendTranscript(transcript);
        } else {
          interim = transcript;
        }
      }

      elements.voiceHint.textContent = interim || 'Listening…';
    };

    recognition.onerror = (event) => {
      const message = event.error === 'not-allowed'
        ? 'Microphone permission was denied.'
        : `Speech recognition error: ${event.error}.`;
      elements.voiceHint.textContent = message;
      stopRecording();
    };

    recognition.onend = () => {
      if (state.isRecording) {
        stopRecording();
      }
    };

    return recognition;
  }

  async function startRecording() {
    if (!SpeechRecognition) {
      setVoiceState('Unsupported', 'unsupported');
      elements.voiceHint.textContent = 'This browser does not expose the Web Speech API. Try current Chrome or Edge.';
      return;
    }

    try {
      if (!state.recognition) {
        state.recognition = createRecognition();
      }

      await setupMeter();
      state.recognition.start();
      state.isRecording = true;
      setVoiceState('Listening', 'listening');
      elements.voiceHint.textContent = 'Listening…';
      elements.micButton.textContent = 'Stop mic';
    } catch (error) {
      setVoiceState('Error', 'unsupported');
      elements.voiceHint.textContent = 'Could not start microphone capture. Check browser permissions.';
      teardownMeter();
    }
  }

  function toggleRecording() {
    if (state.isRecording) {
      stopRecording();
      return;
    }

    startRecording();
  }

  return {
    renderPendingImages,
    handleImageSelection,
    removePendingImage,
    openImageLightbox,
    closeImageLightbox,
    setDropzoneActive,
    hasImageFiles,
    startRecording,
    stopRecording,
    toggleRecording,
  };
}
