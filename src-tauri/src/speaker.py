# The warm Kokoro speaker voice.rs runs as `python -u -c <this> <model dir>`.
# Each stdin line is one utterance, its sentences split by tabs. Sentence n+1
# is made while sentence n plays; "done" goes to stdout when the last ends.
import os
import signal
import subprocess
import sys
import tempfile
import threading
import time

PARENT = os.getppid()


# The app runs this in its own process group, so nothing else stops it, or
# afplay, when the app dies: it watches for that and ends the group itself.
def watch():
    while os.getppid() == PARENT:
        time.sleep(0.5)
    os.killpg(0, signal.SIGTERM)


threading.Thread(target=watch, daemon=True).start()

import soundfile as sf
from kokoro_onnx import Kokoro

DIR = sys.argv[1]
kokoro = Kokoro(f"{DIR}/kokoro-v1.0.onnx", f"{DIR}/voices-v1.0.bin")


def wav(sentence):
    audio, rate = kokoro.create(sentence, voice="af_heart", speed=1.0, lang="en-us")
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
        sf.write(f.name, audio, rate)
    return f.name


def finish(playing):
    if playing:
        playing[0].wait()
        os.unlink(playing[1])


while line := sys.stdin.readline():
    playing = None
    for sentence in filter(None, (s.strip() for s in line.split("\t"))):
        path = wav(sentence)
        finish(playing)
        playing = (subprocess.Popen(["/usr/bin/afplay", path]), path)
    finish(playing)
    print("done", flush=True)
