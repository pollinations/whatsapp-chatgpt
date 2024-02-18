import os
import sys
from pedalboard import Pedalboard, Compressor, Reverb, Gain, LowpassFilter, HighpassFilter
from pedalboard.io import AudioFile

import numpy as np
import logging
import librosa
import tempfile

logging.basicConfig(level=logging.INFO)

def process_and_mix_audio(tts_audio_path, background_audio_path):
    logging.info("Starting audio processing and mixing.")
    # Load the TTS audio file and append 2 seconds of silence to the start and end, considering stereo or mono
    tts_audio_data, tts_samplerate = librosa.load(tts_audio_path, sr=None, mono=False)
    logging.info("Loading TTS audio file.")
    # Ensure tts_audio_data is 2D for consistency in processing
    if tts_audio_data.ndim == 1:
        tts_audio_data = np.expand_dims(tts_audio_data, axis=0)
    tts_channels = tts_audio_data.shape[0]
    tts_silence = np.zeros((tts_channels, int(tts_samplerate * 4)))
    tts_silence_start = np.zeros((tts_channels, int(tts_samplerate * 0.5)))
    tts_audio = np.concatenate((tts_silence_start, tts_audio_data, tts_silence), axis=1)
    logging.info("TTS audio file loaded and processed.")
    # Load the background audio file, normalize it, and heavily compress it before entering the chains
    background_audio, bg_samplerate = librosa.load(background_audio_path, sr=None, mono=False)
    logging.info("Loading background audio file.")
    # Normalize the background audio
    background_audio = librosa.util.normalize(background_audio)
    logging.info("Background audio normalized.")

    background_board = Pedalboard([
        # LowpassFilter(cutoff_frequency_hz=12000),
        # HighpassFilter(cutoff_frequency_hz=200),
        Compressor(threshold_db=-24, ratio=10, release_ms=400),
        Gain(gain_db=0)
    ])
    compressed_background_audio = background_board(background_audio, bg_samplerate)
    logging.info("Background audio compressed.")

    # Adjust the sample rate of the background audio to match the TTS audio if they differ
    if bg_samplerate != tts_samplerate:
        logging.info("Adjusting sample rate of background audio to match TTS audio.")
        from scipy.signal import resample
        compressed_background_audio = resample(compressed_background_audio, int(compressed_background_audio.shape[-1] * (tts_samplerate / bg_samplerate)), axis=-1)

    # Loop the background audio to match the length of the TTS audio
    repeat_times = int(np.ceil(tts_audio.shape[-1] / compressed_background_audio.shape[-1]))
    looped_background_audio = np.tile(compressed_background_audio, (1, repeat_times))[:, :tts_audio.shape[-1]]
    logging.info("Background audio looped to match TTS audio length.")

    # Fade in the background audio over one second
    fade_in_samples = int(tts_samplerate * 2)  # 1 second fade in
    fade_in = np.linspace(0., 1., fade_in_samples)
    looped_background_audio[:,:fade_in_samples] = np.multiply(looped_background_audio[:,:fade_in_samples], fade_in)

    # Fade out the background audio over the last second
    fade_out_samples = int(tts_samplerate * 2)  # 1 second fade out
    fade_out = np.linspace(1., 0., fade_out_samples)
    looped_background_audio[:,-fade_out_samples:] = np.multiply(looped_background_audio[:,-fade_out_samples:], fade_out)

    # Create a pedalboard with effects for the TTS audio
    # tts_board = Pedalboard([
    #     Reverb(room_size=0.25)
    # ])
    # processed_tts_audio = tts_board(tts_audio, tts_samplerate)
    processed_tts_audio = tts_audio
    logging.info("TTS audio processed with effects.")
    # Mix the processed TTS audio with the looped background audio, making the background significantly quieter
    mixed_audio = processed_tts_audio + looped_background_audio * 0.1  # Reduce background audio volume
    logging.info("TTS and background audio mixed.")
    # Apply heavy compression to the final mix with a long release and significantly increase volume with a Gain
    final_mix_board = Pedalboard([
        Compressor(threshold_db=-37, ratio=8, release_ms=2000),
        Gain(gain_db=27),  # Significantly increase volume with a Gain
        Reverb(room_size=0.3,wet_level=0.15,width=0.2)  # Add reverb to make them sound like they are in the same space
    ])
    final_mixed_audio = final_mix_board(mixed_audio, tts_samplerate)
    logging.info("Final audio mix compressed and processed.")

    # Generate a unique temporary file path for the mixed audio to avoid conflicts
    mixed_audio_path = tempfile.mktemp(suffix=".wav", prefix="mixed_audio_", dir=tempfile.gettempdir())
    logging.info("Temporary file path for mixed audio generated.")

    logging.info(f"Final mixed audio shape: {final_mixed_audio.shape}")
    # Save the mixed audio to a new file using AudioFile
    with AudioFile(mixed_audio_path, 'w', samplerate=tts_samplerate, num_channels=1) as f:
        f.write(final_mixed_audio)
    logging.info("Mixed audio saved to file.")

    return mixed_audio_path
if __name__ == "__main__":
    if len(sys.argv) != 3:
        logging.error("Incorrect number of arguments. Usage: python pedalboard.py <TTS audio path> <Background audio path>")
        sys.exit(1)
    tts_audio_path = sys.argv[1]
    background_audio_path = sys.argv[2]
    mixed_audio_path = process_and_mix_audio(tts_audio_path, background_audio_path)
    print(mixed_audio_path)
